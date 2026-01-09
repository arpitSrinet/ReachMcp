import { save, load } from '../utils/storage.js';

// Initialize from storage or default
const initialCarts = load('carts') || {};
const carts = new Map(Object.entries(initialCarts));
const DEFAULT_SESSION_ID = "default_session";
const SESSION_TTL = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

// Track the most recent session ID (for when get_cart is called without sessionId)
let mostRecentSessionId = load('state')?.mostRecentSessionId || null;

// Helper to persist state
function persist() {
  save('carts', Object.fromEntries(carts));
  save('state', { mostRecentSessionId });
}

// Generate a unique session ID
export function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Clean up expired sessions
function cleanupExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [sessionId, cartData] of carts.entries()) {
    if (cartData.expiresAt && now > cartData.expiresAt) {
      carts.delete(sessionId);
      // If this was the most recent session, clear it
      if (sessionId === mostRecentSessionId) {
        mostRecentSessionId = null;
      }
      console.log(`Cleaned up expired session: ${sessionId}`);
      changed = true;
    }
  }
  if (changed) persist();
}

// Run cleanup every 30 minutes
setInterval(cleanupExpiredSessions, 30 * 60 * 1000);

// Get the most recent active session
export function getMostRecentSession() {
  if (!mostRecentSessionId) return null;

  const cartData = carts.get(mostRecentSessionId);
  if (cartData) {
    // Check if expired
    if (cartData.expiresAt && Date.now() > cartData.expiresAt) {
      carts.delete(mostRecentSessionId);
      mostRecentSessionId = null;
      return null;
    }
    return mostRecentSessionId;
  }

  // If most recent session doesn't exist, find the latest one
  let latestSession = null;
  let latestTime = 0;

  for (const [sessionId, cartData] of carts.entries()) {
    if (cartData.expiresAt && Date.now() > cartData.expiresAt) continue; // Skip expired
    const createdAt = cartData.createdAt || 0;
    if (createdAt > latestTime) {
      latestTime = createdAt;
      latestSession = sessionId;
    }
  }

  mostRecentSessionId = latestSession;
  return latestSession;
}

/**
 * Update the most recent session ID (called whenever a session is used)
 * This ensures the session persists across the conversation
 * @param {string} sessionId - Session ID to mark as most recent
 */
export function updateMostRecentSession(sessionId) {
  if (!sessionId) return;
  
  mostRecentSessionId = sessionId;
  persist();
}

/**
 * Check if cart uses new multi-line structure
 */
function isMultiLineCart(cartData) {
  return cartData && Array.isArray(cartData.lines);
}

/**
 * Convert old cart structure to new multi-line structure
 */
function migrateCartToMultiLine(cartData) {
  if (!cartData || !cartData.items || cartData.items.length === 0) {
    return {
      lines: [],
      total: 0,
      expiresAt: cartData?.expiresAt,
      createdAt: cartData?.createdAt || Date.now()
    };
  }

  // Group items by type and create lines
  const lines = [];
  let lineNumber = 1;

  // Find all plans first
  const plans = cartData.items.filter(item => item.type === 'plan');
  
  plans.forEach(plan => {
    const line = {
      lineNumber: lineNumber++,
      plan: plan,
      device: null,
      protection: null,
      sim: { type: 'sim', simType: null, iccId: null }
    };
    
    // Find device for this line (if any)
    const device = cartData.items.find(item => 
      item.type === 'device' && item.lineNumber === line.lineNumber
    );
    if (device) {
      line.device = device;
    }
    
    // Find protection for this line (if any)
    const protection = cartData.items.find(item => 
      item.type === 'protection' && item.lineNumber === line.lineNumber
    );
    if (protection) {
      line.protection = protection;
    }
    
    lines.push(line);
  });

  // Calculate total from all items
  const total = cartData.items.reduce((sum, item) => sum + (item.price || 0), 0);

  return {
    lines,
    total,
    expiresAt: cartData.expiresAt,
    createdAt: cartData.createdAt || Date.now()
  };
}

export function getCart(sessionId = null) {
  // If no sessionId provided, try to get the most recent session
  let id = sessionId;
  if (!id) {
    const recentSession = getMostRecentSession();
    id = recentSession || DEFAULT_SESSION_ID;
  }

  const cartData = carts.get(id);

  // Check if cart exists and is not expired
  if (cartData) {
    if (cartData.expiresAt && Date.now() > cartData.expiresAt) {
      // Cart expired, delete it
      carts.delete(id);
      if (id === mostRecentSessionId) {
        mostRecentSessionId = null;
      }
      return { items: [], total: 0, sessionId: id };
    }
    
    // Support both old and new structure
    if (isMultiLineCart(cartData)) {
      // New structure - convert to old format for backward compatibility
      const items = [];
      cartData.lines.forEach(line => {
        if (line.plan) items.push(line.plan);
        if (line.device) items.push(line.device);
        if (line.protection) items.push(line.protection);
        if (line.sim && line.sim.simType) items.push(line.sim);
      });
      return { items, total: cartData.total || 0, sessionId: id, lines: cartData.lines };
    } else {
      // Old structure
      return { items: cartData.items || [], total: cartData.total || 0, sessionId: id };
    }
  }

  return { items: [], total: 0, sessionId: id };
}

// New function that returns cart with the sessionId that was actually used
export function getCartWithSession(sessionId = null) {
  return getCart(sessionId);
}

/**
 * Get cart in multi-line format
 */
export function getCartMultiLine(sessionId = null) {
  let id = sessionId;
  if (!id) {
    const recentSession = getMostRecentSession();
    id = recentSession || DEFAULT_SESSION_ID;
  }

  const cartData = carts.get(id);

  if (cartData) {
    if (cartData.expiresAt && Date.now() > cartData.expiresAt) {
      carts.delete(id);
      if (id === mostRecentSessionId) {
        mostRecentSessionId = null;
      }
      return { lines: [], total: 0, sessionId: id };
    }
    
    if (isMultiLineCart(cartData)) {
      return {
        lines: cartData.lines || [],
        total: cartData.total || 0,
        sessionId: id,
        expiresAt: cartData.expiresAt,
        createdAt: cartData.createdAt
      };
    } else {
      // Migrate old structure
      const migrated = migrateCartToMultiLine(cartData);
      // Update cart with new structure
      carts.set(id, {
        ...cartData,
        ...migrated
      });
      persist();
      return {
        lines: migrated.lines,
        total: migrated.total,
        sessionId: id,
        expiresAt: cartData.expiresAt,
        createdAt: cartData.createdAt
      };
    }
  }

  return { lines: [], total: 0, sessionId: id };
}

/**
 * Add item to cart (supports both old and new structure)
 * @param {string} sessionId - Session ID
 * @param {Object} item - Item to add
 * @param {number} lineNumber - Optional line number for multi-line structure
 */
export function addToCart(sessionId = null, item, lineNumber = null) {
  // Auto-generate sessionId if not provided
  const id = sessionId || generateSessionId();
  const cartData = carts.get(id);
  
  const expiresAt = Date.now() + SESSION_TTL;
  const createdAt = cartData?.createdAt || Date.now();

  // Check if we should use multi-line structure
  const useMultiLine = lineNumber !== null && lineNumber > 0;
  
  if (useMultiLine) {
    // Multi-line structure
    let cart = getCartMultiLine(id);
    
    // Ensure lines array exists
    if (!cart.lines || cart.lines.length === 0) {
      cart.lines = [];
    }
    
    // Find or create line
    let line = cart.lines.find(l => l.lineNumber === lineNumber);
    if (!line) {
      line = {
        lineNumber: lineNumber,
        plan: null,
        device: null,
        protection: null,
        sim: { type: 'sim', simType: null, iccId: null }
      };
      cart.lines.push(line);
    }
    
    // Add item to appropriate field based on type
    if (item.type === 'plan') {
      line.plan = item;
    } else if (item.type === 'device') {
      line.device = item;
    } else if (item.type === 'protection') {
      line.protection = item;
    } else if (item.type === 'sim') {
      line.sim = item;
    } else {
      // Fallback: add to plan if unknown type
      if (!line.plan) {
        line.plan = item;
      }
    }
    
    // Calculate total
    cart.total = cart.lines.reduce((sum, l) => {
      return sum + 
        (l.plan?.price || 0) +
        (l.device?.price || 0) +
        (l.protection?.price || 0) +
        (l.sim?.price || 0);
    }, 0);
    
    carts.set(id, {
      ...cart,
      expiresAt,
      createdAt
    });
    
    mostRecentSessionId = id;
    persist();
    
    return { cart, sessionId: id };
  } else {
    // Old structure (backward compatibility)
    const cart = getCart(id);
    
    // Add item to cart
    cart.items.push(item);
    cart.total = cart.items.reduce((sum, item) => sum + (item.price || 0), 0);
    
    carts.set(id, {
      items: cart.items,
      total: cart.total,
      expiresAt: expiresAt,
      createdAt: createdAt
    });
    
    mostRecentSessionId = id;
    persist();
    
    return { cart, sessionId: id };
  }
}

/**
 * Add item to specific line in multi-line cart
 */
export function addToCartLine(sessionId, lineNumber, item) {
  return addToCart(sessionId, item, lineNumber);
}

export function clearCart(sessionId) {
  carts.delete(sessionId);
  if (sessionId === mostRecentSessionId) {
    mostRecentSessionId = null;
  }
  persist();
}

/**
 * Remove an item from a specific line in the cart
 * @param {string} sessionId - Session ID
 * @param {number} lineNumber - Line number (1-based)
 * @param {string} itemType - Type of item to remove: 'plan', 'device', 'protection', 'sim'
 */
export function removeFromCartLine(sessionId, lineNumber, itemType) {
  if (!sessionId) {
    throw new Error('Session ID is required');
  }
  
  const cart = getCartMultiLine(sessionId);
  
  if (!cart || !cart.lines || cart.lines.length === 0) {
    return { cart: { lines: [], total: 0, sessionId }, sessionId };
  }
  
  // Find the line
  const line = cart.lines.find(l => (l.lineNumber || 0) === lineNumber);
  if (!line) {
    return { cart, sessionId };
  }
  
  // Remove the item based on type
  if (itemType === 'plan') {
    line.plan = null;
  } else if (itemType === 'device') {
    line.device = null;
    // Also remove protection if device is removed
    if (line.protection) {
      line.protection = null;
    }
  } else if (itemType === 'protection') {
    line.protection = null;
  } else if (itemType === 'sim') {
    line.sim = { type: 'sim', simType: null, iccId: null, price: 0 };
  }
  
  // Recalculate total
  cart.total = cart.lines.reduce((sum, l) => {
    return sum + 
      (l.plan?.price || 0) +
      (l.device?.price || 0) +
      (l.protection?.price || 0) +
      (l.sim?.price || 0);
  }, 0);
  
  // Update cart storage
  const expiresAt = Date.now() + SESSION_TTL;
  const createdAt = cart.createdAt || Date.now();
  
  carts.set(sessionId, {
    ...cart,
    expiresAt,
    createdAt
  });
  
  mostRecentSessionId = sessionId;
  persist();
  
  return { cart, sessionId };
}

/**
 * Remove all items from cart (clear all lines but keep structure)
 * @param {string} sessionId - Session ID
 */
export function removeAllFromCart(sessionId) {
  if (!sessionId) {
    throw new Error('Session ID is required');
  }
  
  const cart = getCartMultiLine(sessionId);
  
  // Clear all items from all lines
  if (cart && cart.lines && cart.lines.length > 0) {
    cart.lines.forEach(line => {
      line.plan = null;
      line.device = null;
      line.protection = null;
      line.sim = { type: 'sim', simType: null, iccId: null, price: 0 };
    });
    
    cart.total = 0;
    
    const expiresAt = Date.now() + SESSION_TTL;
    const createdAt = cart.createdAt || Date.now();
    
    carts.set(sessionId, {
      ...cart,
      expiresAt,
      createdAt
    });
    
    mostRecentSessionId = sessionId;
    persist();
  }
  
  return { cart: cart || { lines: [], total: 0, sessionId }, sessionId };
}

