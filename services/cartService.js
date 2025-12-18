// In production: Use DynamoDB/Redis
const carts = new Map();
const DEFAULT_SESSION_ID = "default_session";
const SESSION_TTL = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

// Track the most recent session ID (for when get_cart is called without sessionId)
let mostRecentSessionId = null;

// Generate a unique session ID
export function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Clean up expired sessions
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, cartData] of carts.entries()) {
    if (cartData.expiresAt && now > cartData.expiresAt) {
      carts.delete(sessionId);
      // If this was the most recent session, clear it
      if (sessionId === mostRecentSessionId) {
        mostRecentSessionId = null;
      }
      console.log(`Cleaned up expired session: ${sessionId}`);
    }
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupExpiredSessions, 30 * 60 * 1000);

// Get the most recent active session
function getMostRecentSession() {
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
    return { items: cartData.items || [], total: cartData.total || 0, sessionId: id };
  }
  
  return { items: [], total: 0, sessionId: id };
}

// New function that returns cart with the sessionId that was actually used
export function getCartWithSession(sessionId = null) {
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
    return { items: cartData.items || [], total: cartData.total || 0, sessionId: id };
  }
  
  return { items: [], total: 0, sessionId: id };
}

export function addToCart(sessionId = null, item) {
  // Auto-generate sessionId if not provided
  const id = sessionId || generateSessionId();
  const cart = getCart(id);
  
  // Add item to cart
  cart.items.push(item);
  cart.total = cart.items.reduce((sum, item) => sum + item.price, 0);
  
  // Store cart with expiration time (2 hours from now)
  const expiresAt = Date.now() + SESSION_TTL;
  const createdAt = carts.get(id)?.createdAt || Date.now();
  carts.set(id, {
    ...cart,
    expiresAt: expiresAt,
    createdAt: createdAt
  });
  
  // Update most recent session
  mostRecentSessionId = id;
  
  return { cart, sessionId: id };
}

export function clearCart(sessionId) {
  carts.delete(sessionId);
}

