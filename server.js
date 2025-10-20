import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const app = express();
app.use(bodyParser.json());

const PAYSTACK_SECRET = "sk_test_xxxxxxx";
const BASE_URL = "https://api.paystack.co";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SUPABASE_ANON_KEY
);

app.post("/api/credit", async (req, res) => {
  try {
    const { userId, amount, description = "Wallet Credit" } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid userId or amount" });
    }

    const reference = `credit_${crypto.randomBytes(16).toString("hex")}`;

    const { data: wallet, error: fetchError } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    const currentBalance = wallet ? parseFloat(wallet.balance) : 0;
    const newBalance = currentBalance + amount;

    const { error: upsertError } = await supabase
      .from("wallets")
      .upsert(
        {
          user_id: userId,
          balance: newBalance,
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      return res.status(500).json({ error: upsertError.message });
    }

    const { error: txError } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        type: "credit",
        amount,
        reference,
        status: "success",
        description,
        metadata: { previous_balance: currentBalance, new_balance: newBalance }
      });

    if (txError) {
      console.error("Transaction log error:", txError);
    }

    res.json({
      success: true,
      reference,
      balance: newBalance,
      message: "Wallet credited successfully"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/transfer", async (req, res) => {
  try {
    const { userId, amount, bankCode, accountNumber, name } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid userId or amount" });
    }

    const { data: wallet, error: fetchError } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    if (!wallet) {
      return res.status(400).json({ error: "Wallet not found. Please credit your wallet first." });
    }

    const currentBalance = parseFloat(wallet.balance);
    if (currentBalance < amount) {
      return res.status(400).json({
        error: "Insufficient balance",
        balance: currentBalance,
        required: amount
      });
    }

    const recipient = await axios.post(
      `${BASE_URL}/transferrecipient`,
      {
        type: "nuban",
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: "GHS"
      },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    const recipientCode = recipient.data.data.recipient_code;

    const transfer = await axios.post(
      `${BASE_URL}/transfer`,
      {
        source: "balance",
        amount,
        recipient: recipientCode,
        reason: "Wallet Withdrawal"
      },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    const reference = transfer.data.data.reference;

    const { error: updateError } = await supabase
      .from("wallets")
      .update({
        last_transaction_id: reference,
        last_status: "pending",
        updated_at: new Date().toISOString()
      })
      .eq("user_id", userId);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    const { error: txError } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        type: "transfer",
        amount,
        reference,
        status: "pending",
        description: `Transfer to ${name}`,
        metadata: {
          bank_code: bankCode,
          account_number: accountNumber,
          recipient_name: name,
          recipient_code: recipientCode
        }
      });

    if (txError) {
      console.error("Transaction log error:", txError);
    }

    res.json({
      success: true,
      transfer: transfer.data.data,
      message: "Transfer initiated successfully"
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/wallet/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: wallet, error } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!wallet) {
      return res.json({
        user_id: userId,
        balance: 0,
        message: "Wallet not found. Credit your wallet to get started."
      });
    }

    res.json({
      user_id: wallet.user_id,
      balance: parseFloat(wallet.balance),
      last_status: wallet.last_status,
      created_at: wallet.created_at,
      updated_at: wallet.updated_at
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/transactions/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const { data: transactions, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      transactions: transactions || [],
      count: transactions?.length || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("🚀 Server running on port 3000"));
