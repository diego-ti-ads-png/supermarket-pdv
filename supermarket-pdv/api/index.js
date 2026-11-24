import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(helmet());
app.use(cors({
  origin: process.env.APP_ORIGIN ? process.env.APP_ORIGIN.split(",") : true,
  credentials: false
}));
app.use(express.json({ limit: "1mb" }));

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
let supabase;
function db() {
  if (!supabase) {
    const missing = required.filter(k => !process.env[k]);
    if (missing.length) throw Object.assign(new Error(`Configuração ausente: ${missing.join(", ")}`), { status: 503 });
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return supabase;
}
const ROLES = ["Diretor", "Gerente", "Estoquista", "Vendedor", "Administrativo"];
const PERMISSIONS = {
  Diretor: ["sales", "inventory", "finance", "users", "operations"],
  Gerente: ["sales", "inventory", "operations"],
  Estoquista: ["inventory"],
  Vendedor: ["sales"],
  Administrativo: ["finance"]
};
export const markup = (cost, price) => {
  if (!Number.isFinite(cost) || !Number.isFinite(price) || cost <= 0 || price < 0) {
    throw Object.assign(new Error("Preço de custo deve ser maior que zero e preço de venda não pode ser negativo."), { status: 400 });
  }
  return (price - cost) / cost;
};
export const isValidEmail = email =>
  typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
export const passwordErrors = password => {
  const errors = [];
  if (typeof password !== "string" || password.length < 12) errors.push("A senha deve ter no mínimo 12 caracteres.");
  if (!/[A-Z]/.test(password || "")) errors.push("Inclua pelo menos uma letra maiúscula.");
  if (!/[a-z]/.test(password || "")) errors.push("Inclua pelo menos uma letra minúscula.");
  if (!/[^A-Za-z0-9]/.test(password || "")) errors.push("Inclua pelo menos um caractere especial.");
  return errors;
};
export const isCriticalStock = quantity => Number(quantity) <= 3;

async function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Token de autenticação não informado." });
    const { data, error } = await db().auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: "Sessão inválida ou expirada." });
    const { data: profile, error: profileError } = await db()
      .from("profiles").select("id,email,full_name,role,active").eq("id", data.user.id).single();
    if (profileError || !profile || !profile.active) return res.status(403).json({ error: "Usuário sem perfil ativo." });
    req.user = profile;
    next();
  } catch (e) { next(e); }
}
const allow = (...permissions) => (req, res, next) => {
  const userPermissions = PERMISSIONS[req.user?.role] || [];
  if (!permissions.some(p => userPermissions.includes(p))) {
    return res.status(403).json({ error: "Seu perfil não tem permissão para esta operação." });
  }
  next();
};
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "supermarket-pdv" }));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const { email, password, full_name } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: "Informe um endereço de e-mail válido." });
  const errors = passwordErrors(password);
  if (errors.length) return res.status(400).json({ error: "A senha não atende aos requisitos.", details: errors });
  if (!full_name?.trim()) return res.status(400).json({ error: "Informe o nome completo." });
  // Novos cadastros recebem o perfil Vendedor. Diretor deve promover os demais pela gestão.
  const { data, error } = await db().auth.signUp({ email: email.trim().toLowerCase(), password });
  if (error) return res.status(400).json({ error: error.message });
  if (data.user) {
    const { error: insertError } = await db().from("profiles").upsert({
      id: data.user.id, email: data.user.email, full_name: full_name.trim(), role: "Vendedor", active: true
    });
    if (insertError) return res.status(500).json({ error: "Conta criada, mas não foi possível criar o perfil. Contate o administrador." });
  }
  res.status(201).json({ message: "Cadastro realizado. Confirme seu e-mail se a confirmação estiver habilitada." });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || !password) return res.status(400).json({ error: "E-mail válido e senha são obrigatórios." });
  const { data, error } = await db().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error || !data.session) return res.status(401).json({ error: "E-mail ou senha incorretos." });
  const { data: profile, error: pe } = await db().from("profiles")
    .select("id,email,full_name,role,active").eq("id", data.user.id).single();
  if (pe || !profile?.active) return res.status(403).json({ error: "Usuário inativo ou sem perfil cadastrado." });
  res.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, user: profile });
}));

app.get("/api/auth/me", auth, (req, res) => res.json({ user: req.user, permissions: PERMISSIONS[req.user.role] || [] }));

app.get("/api/products", auth, allow("inventory", "sales", "operations"), asyncRoute(async (_req, res) => {
  const { data, error } = await db().from("products").select("*").order("name");
  if (error) throw error;
  res.json(data.map(p => ({ ...p, markup: Number(p.cost_price) > 0 ? markup(Number(p.cost_price), Number(p.sale_price)) : null, critical: isCriticalStock(p.stock_quantity) })));
}));
app.post("/api/products", auth, allow("inventory", "operations"), asyncRoute(async (req, res) => {
  const { name, stock_quantity, cost_price, sale_price, sku } = req.body || {};
  if (!name?.trim() || !Number.isInteger(Number(stock_quantity)) || Number(stock_quantity) < 0) {
    return res.status(400).json({ error: "Nome e quantidade inteira não negativa são obrigatórios." });
  }
  markup(Number(cost_price), Number(sale_price));
  const { data, error } = await db().from("products").insert({
    name: name.trim(), sku: sku || null, stock_quantity: Number(stock_quantity),
    cost_price: Number(cost_price), sale_price: Number(sale_price)
  }).select().single();
  if (error) throw error;
  res.status(201).json(data);
}));
app.patch("/api/products/:id", auth, allow("inventory", "operations"), asyncRoute(async (req, res) => {
  const allowed = ["name", "sku", "stock_quantity", "cost_price", "sale_price"];
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Nenhum campo válido informado." });
  if (patch.cost_price !== undefined || patch.sale_price !== undefined) {
    const { data: old, error: readError } = await db().from("products").select("cost_price,sale_price").eq("id", req.params.id).single();
    if (readError) throw readError;
    markup(Number(patch.cost_price ?? old.cost_price), Number(patch.sale_price ?? old.sale_price));
  }
  if (patch.stock_quantity !== undefined && (!Number.isInteger(Number(patch.stock_quantity)) || Number(patch.stock_quantity) < 0))
    return res.status(400).json({ error: "Estoque deve ser um número inteiro não negativo." });
  const { data, error } = await db().from("products").update(patch).eq("id", req.params.id).select().single();
  if (error) throw error;
  res.json(data);
}));

app.post("/api/sales", auth, allow("sales"), asyncRoute(async (req, res) => {
  const { items, payment_method, customer_name } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "Adicione ao menos um item à venda." });
  if (!["dinheiro", "pix", "credito", "debito", "prazo"].includes(payment_method))
    return res.status(400).json({ error: "Forma de pagamento inválida." });
  // RPC executa venda, itens e baixa de estoque em uma única transação PostgreSQL.
  const { data, error } = await db().rpc("create_sale", {
    p_items: items.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
    p_payment_method: payment_method,
    p_customer_name: customer_name || null,
    p_user_id: req.user.id
  });
  if (error) {
    if (error.message?.includes("ESTOQUE_INSUFICIENTE")) return res.status(409).json({ error: "Estoque insuficiente para um ou mais produtos." });
    throw error;
  }
  res.status(201).json(data);
}));

app.get("/api/finance/entries", auth, allow("finance"), asyncRoute(async (_req, res) => {
  const { data, error } = await db().from("finance_entries").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  res.json(data);
}));
app.post("/api/finance/entries", auth, allow("finance"), asyncRoute(async (req, res) => {
  const { type, description, amount, due_date } = req.body || {};
  if (!["entrada", "saida"].includes(type) || !description?.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0)
    return res.status(400).json({ error: "Tipo, descrição e valor positivo são obrigatórios." });
  const { data, error } = await db().from("finance_entries").insert({
    type, description: description.trim(), amount: Number(amount), due_date: due_date || null, created_by: req.user.id
  }).select().single();
  if (error) throw error;
  res.status(201).json(data);
}));
app.get("/api/users", auth, allow("users"), asyncRoute(async (_req, res) => {
  const { data, error } = await db().from("profiles").select("id,email,full_name,role,active,created_at").order("created_at");
  if (error) throw error;
  res.json(data);
}));
app.patch("/api/users/:id", auth, allow("users"), asyncRoute(async (req, res) => {
  const { role, active } = req.body || {};
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: "Perfil inválido." });
  const patch = {};
  if (role !== undefined) patch.role = role;
  if (active !== undefined) patch.active = Boolean(active);
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Informe perfil ou situação." });
  const { data, error } = await db().from("profiles").update(patch).eq("id", req.params.id)
    .select("id,email,full_name,role,active").single();
  if (error) throw error;
  res.json(data);
}));

app.use((_req, res) => res.status(404).json({ error: "Rota não encontrada." }));
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = Number(err.status) || 500;
  res.status(status).json({ error: status >= 500 ? "Erro interno. Tente novamente." : err.message });
});

export default app;
