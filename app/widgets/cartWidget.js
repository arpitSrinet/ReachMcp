/**
 * Render cart data as Apps SDK widget
 */
export function renderCart(cart, sessionId) {
  const items = cart.items?.map(item => ({
    name: item.name,
    type: item.type,
    price: `$${item.price}`
  })) || [];
  
  // Apps SDK widget format
  return {
    type: "widget",
    widget: "cartSummary",
    data: {
      title: "Shopping Cart",
      subtitle: `${cart.items?.length || 0} item(s)`,
      items: items,
      total: `$${cart.total || 0}`,
      sessionId: sessionId || "default"
    },
    actions: [
      {
        type: "button",
        label: "Proceed to Checkout",
        action: "checkout",
        params: {
          sessionId: sessionId
        }
      }
    ]
  };
}

