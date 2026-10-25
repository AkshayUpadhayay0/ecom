# Click path: from the home page to a confirmed order

Urban Ìbílé design prototype v3. Sample content only: names, prices, sizes, addresses and orders are made up and shown in brackets. Nothing you type is stored or sent, and there is no card form.

Open the prototype (`node scripts/serve.mjs`, then http://localhost:4173, or the private link). On a phone, open the same link, or use `phone.html`. The small **Prototype guide** button at the bottom of every screen lists all of this with links, and can reset the demo.

1. **Home** (`#/`). A model walks toward you in a full-screen loop. Scroll: one video band, category tiles, a "New outfits" carousel. Tap **Shop**.
2. **Shop** (`#/shop`). Large video cards. Try the type chips, the **Sort by** menu, and page 2. On a card, hover (or tap the **+** on a phone) for **Quick add**. Open **[Sample outfit 03]**.
3. **The outfit** (`#/product/sample-outfit-03`). Video first, then sizes, the **Find my size** block, quantity, and Add to cart (fixed to the bottom on a phone). Open Description, Material, Delivery and Returns. Tap **Find my size**.
4. **Sign in** when asked (any email and password works: it is simulated).
5. **Find my size** (`#/fit/sample-outfit-03`). Enter body measurements in inches (or use **Fill in sample measurements**), choose Tailored, Standard or Oversized, and see the recommended size with how each measurement was matched, and stock. Try **Prefer a different size?** Tap **Use size M**.
6. **Add to cart.** The cart drawer slides in. Choose **View cart**, then **Checkout**.
7. **Delivery.** Choose **Fill in sample details** and a delivery zone (sample fees). The summary shows subtotal, delivery charge and total. **Continue to review**.
8. **Review.** Check the products, sizes, quantities, address and totals. **Continue to secure payment**.
9. **Payment.** A neutral "Secure payment with Paystack" step (not a copy of Paystack's page). The dashed **Prototype** switch chooses what happens:
   - **Payment fails**, then **Pay**: a failed-payment screen; the cart is unchanged; **Try again**.
   - **Payment succeeds**, then **Pay**: the order is confirmed.
10. **Confirmation.** Order number UI-[0005], status **Being prepared**. Choose **View my orders**.
11. **My orders** (`#/orders`). The new order with the **Being prepared → Sent out → Delivered** timeline. Use the **Prototype control** to move it along. Two earlier sample orders show the other states.

Other screens worth a look (all in the guide): search suggestions (tap the search icon, type "blaz"), "No outfits found. Try another word." (`#/search?q=zzzz`), a sold-out outfit (`#/product/sample-outfit-06`), a size that is out of range (`#/fit/sample-outfit-03?demo=range`), a cart with a stock problem (`#/cart?demo=stock`), and the **height and weight concept** (`#/fit-concept`, marked "Pending client decision: needs brand sizing rules").
