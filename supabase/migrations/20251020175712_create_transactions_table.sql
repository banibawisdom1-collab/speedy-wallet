/*
  # Create transactions table

  1. New Tables
    - `transactions`
      - `id` (uuid, primary key) - Unique transaction identifier
      - `user_id` (text, not null) - User identifier
      - `type` (text, not null) - Transaction type (credit/debit/transfer)
      - `amount` (numeric, not null) - Transaction amount in smallest currency unit
      - `reference` (text, unique) - Transaction reference/ID
      - `status` (text, default 'pending') - Transaction status (pending/success/failed)
      - `description` (text) - Transaction description
      - `metadata` (jsonb) - Additional transaction data (bank details, recipient info, etc.)
      - `created_at` (timestamptz) - Transaction timestamp
      - `updated_at` (timestamptz) - Last update timestamp

  2. Security
    - Enable RLS on `transactions` table
    - Add policy for authenticated users to read their own transactions
    - Add policy for authenticated users to insert their own transactions
    - Add policy for service role to manage all transactions

  3. Indexes
    - Index on user_id for fast lookups
    - Index on reference for webhook processing
    - Index on created_at for sorting
*/

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('credit', 'debit', 'transfer')),
  amount numeric NOT NULL CHECK (amount > 0),
  reference text UNIQUE,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own transactions"
  ON transactions
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert own transactions"
  ON transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Service role can manage all transactions"
  ON transactions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);