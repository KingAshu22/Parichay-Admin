import { NextRequest, NextResponse } from "next/server";
import { mongooseConnect } from "@/lib/mongoose";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import shortid from "shortid";
const Razorpay = require("razorpay");

export async function POST(req: NextRequest) {
  const { cartItems, customer } = await req.json();

  if (!cartItems || cartItems.length === 0 || !customer) {
    return new NextResponse("Not enough data to checkout", { status: 400 });
  }

  // Connect to MongoDB
  await mongooseConnect();

  // Fetch product information based on cartItems
  const productIds = cartItems.map((item) => item.item._id);
  const uniqueProductIds = [...new Set(productIds)];
  const productsInfos = await Product.find({ _id: { $in: uniqueProductIds } });

  // Prepare line items for Razorpay
  let totalAmount = 0;
  let line_items = cartItems.map((cartItem) => {
    const productInfo = productsInfos.find(
      (p) => p._id.toString() === cartItem.item._id
    );
    if (!productInfo) {
      throw new Error("Product not found: " + cartItem.item._id);
    }
    const amount = productInfo.price * cartItem.quantity * 100; // Convert to smallest currency unit
    totalAmount += amount;
    return {
      amount: amount.toString(),
      currency: "INR",
      name: productInfo.title,
      quantity: cartItem.quantity,
    };
  });

  // Create Razorpay instance
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  // Create Razorpay order options
  const options = {
    amount: totalAmount.toString(), // The total amount should be in the smallest currency unit
    currency: "INR",
    receipt: shortid.generate(),
    payment_capture: 1,
  };

  try {
    // Create Razorpay order
    const order = await razorpay.orders.create(options);

    // Create order in MongoDB with additional details
    await Order.create({
      cartItems: line_items,
      customer: customer,
      orderId: order.id,
      amount: order.amount,
      currency: "INR",
      receipt: options.receipt,
      payment_capture: options.payment_capture,
    });

    // Respond with order details
    return NextResponse.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
    }, { headers: corsHeaders });
  } catch (err) {
    console.error("Error creating Razorpay order:", err);
    return new NextResponse("Failed to create Razorpay order", { status: 500 });
  }
}
