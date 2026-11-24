const API = "/api";
let token = localStorage.getItem("sm_token");
let currentUser = null;
let registering = false;
const $ = id => document.getElementById(id);
const money = n => Number(n || 0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const request = async (path, options={}) => {
  const response = await fetch(API+path,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers||{})}});
  const body = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body.details?.join(" ") || body.error || "Falha na solicitação.");
  return body;
};
const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const passwordState = p => ({length:p.length>=12,upper:/[A-Z]/.test(p),lower:/[a-z]/.test(p),special:/[^A-Za-z0-9]/.test(p)});
function authMode(create){
  registering=create;$("auth-title").textContent=create?"Criar conta":"Acesse sua conta";
  $("auth-submit").textContent=create?"Cadastrar":"Entrar";$("toggle-auth").textContent=create?"Já tenho uma conta":"Criar uma conta";
  $("name-field").classList.toggle("hidden",!create);$("password-rules").classList.toggle("hidden",!create);
}
$("toggle-auth").onclick=()=>authMode(!registering);
$("email").addEventListener("input",()=>{$("email-hint").textContent=validEmail($("email").value)?"E-mail válido.":"Informe um e-mail válido.";});
$("password").addEventListener("input",()=>{
  const state=passwordState($("password").value);
  Object.entries(state).forEach(([k,v])=>document.querySelector(`[data-rule="${k}"]`).classList.toggle("ok",v));
});
$("auth-form").onsubmit=async e=>{
  e.preventDefault();$("auth-message").textContent="";
  const email=$("email").value.trim(),password=$("password").value;
  if(!validEmail(email)){ $("auth-message").textContent="Informe um e-mail válido.";return; }
  if(registering){
    const errors=Object.entries(passwordState(password)).filter(([,v])=>!v);
    if(errors.length){$("auth-message").textContent="A senha não atende a todos os requisitos.";return;}
  }
  try{
    if(registering){
      await request("/auth/register",{method:"POST",body:JSON.stringify({email,password,full_name:$("full-name").value})});
      $("auth-message").textContent="Cadastro realizado. Verifique seu e-mail e faça login.";
      authMode(false);
    }else{
      const data=await request("/auth/login",{method:"POST",body:JSON.stringify({email,password})});
      token=data.access_token;localStorage.setItem("sm_token",token);currentUser=data.user;showApp();
    }
  }catch(err){$("auth-message").textContent=err.message;}
};
$("logout").onclick=()=>{localStorage.removeItem("sm_token");token=null;currentUser=null;$("app-screen").classList.add("hidden");$("auth-screen").classList.remove("hidden");};
const navItems=[["sales","🧾 Vendas","PDV"],["inventory","📦 Estoque","Estoque"],["finance","💰 Financeiro","Financeiro"],["users","👥 Usuários","Usuários"]];
function showApp(){
  $("auth-screen").classList.add("hidden");$("app-screen").classList.remove("hidden");
  $("user-label").textContent=`${currentUser.full_name} · ${currentUser.role}`;
  $("today").textContent=new Date().toLocaleDateString("pt-BR");
  const permissions=({Diretor:["sales","inventory","finance","users"],Gerente:["sales","inventory"],Estoquista:["inventory"],Vendedor:["sales"],Administrativo:["finance"]})[currentUser.role]||[];
  $("sidebar").innerHTML=navItems.filter(([key])=>permissions.includes(key)).map(([key,label])=>`<button class="nav-button" data-page="${key}">${label}</button>`).join("");
  document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>openPage(b.dataset.page));
  openPage(permissions[0]||"sales");
}
async function openPage(page){
  document.querySelectorAll(".nav-button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  $("page-title").textContent=({sales:"Ponto de venda",inventory:"Controle de estoque",finance:"Financeiro",users:"Gestão de usuários"})[page];
  try{ if(page==="inventory") await inventoryPage(); if(page==="sales") await salesPage(); if(page==="finance") await financePage(); if(page==="users") await usersPage(); }
  catch(e){$("page-content").innerHTML=`<div class="panel">${e.message}</div>`;}
}
async function inventoryPage(){
  const products=await request("/products");
  $("page-content").innerHTML=`
    <div class="panel"><h2>Cadastrar mercadoria</h2><form id="product-form" class="grid-form">
      <label>Nome<input name="name" required></label><label>SKU / código<input name="sku"></label>
      <label>Quantidade<input name="stock_quantity" type="number" min="0" step="1" required></label>
      <label>Preço de custo (R$)<input name="cost_price" type="number" min=".01" step=".01" required></label>
      <label>Preço de venda (R$)<input name="sale_price" type="number" min="0" step=".01" required></label>
      <div><button class="action">Salvar produto</button></div></form></div>
    <div class="panel"><h2>Produtos cadastrados</h2><div class="table-wrap"><table><thead><tr><th>Produto</th><th>Estoque</th><th>Custo</th><th>Venda</th><th>Markup</th><th>Status</th></tr></thead><tbody>
    ${products.map(p=>`<tr><td>${escapeHtml(p.name)}</td><td>${p.stock_quantity}</td><td>${money(p.cost_price)}</td><td>${money(p.sale_price)}</td><td>${p.markup===null?"—":(p.markup*100).toFixed(1)+"%"}</td><td>${p.critical?'<span class="critical">Crítico</span>':'<span class="good">Normal</span>'}</td></tr>`).join("")||'<tr><td colspan="6">Nenhum produto cadastrado.</td></tr>'}
    </tbody></table></div><p class="notice">Estoque crítico: 3 unidades ou menos.</p></div>`;
  $("product-form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const data=Object.fromEntries(f);data.stock_quantity=Number(data.stock_quantity);data.cost_price=Number(data.cost_price);data.sale_price=Number(data.sale_price);try{await request("/products",{method:"POST",body:JSON.stringify(data)});inventoryPage();}catch(err){alert(err.message);}};
}
async function salesPage(){
  const products=await request("/products");
  $("page-content").innerHTML=`<div class="panel"><h2>Nova venda</h2><form id="sale-form" class="grid-form">
    <label>Produto<select id="sale-product">${products.map(p=>`<option value="${p.id}" data-price="${p.sale_price}" data-stock="${p.stock_quantity}">${escapeHtml(p.name)} — ${money(p.sale_price)} (estoque ${p.stock_quantity})</option>`).join("")}</select></label>
    <label>Quantidade<input id="sale-qty" type="number" min="1" value="1"></label><label>Pagamento<select id="payment"><option value="dinheiro">Dinheiro</option><option value="pix">PIX</option><option value="credito">Crédito</option><option value="debito">Débito</option><option value="prazo">A prazo</option></select></label>
    <label>Cliente (opcional)<input id="customer"></label><div><button class="action" ${products.length?"":"disabled"}>Finalizar venda</button></div>
  </form><p class="notice">${products.length?"A baixa de estoque ocorre automaticamente após a confirmação.":"Cadastre produtos no estoque antes de vender."}</p></div>`;
  $("sale-form").onsubmit=async e=>{e.preventDefault();const option=$("sale-product").selectedOptions[0];const qty=Number($("sale-qty").value);if(!option||qty<1||qty>Number(option.dataset.stock)){alert("Quantidade inválida ou estoque insuficiente.");return;}try{const result=await request("/sales",{method:"POST",body:JSON.stringify({items:[{product_id:option.value,quantity:qty}],payment_method:$("payment").value,customer_name:$("customer").value})});alert(`Venda concluída! Total: ${money(result.total)}`);salesPage();}catch(err){alert(err.message);}};
}
async function financePage(){
  const entries=await request("/finance/entries");
  const income=entries.filter(x=>x.type==="entrada").reduce((a,x)=>a+Number(x.amount),0),out=entries.filter(x=>x.type==="saida").reduce((a,x)=>a+Number(x.amount),0);
  $("page-content").innerHTML=`<div class="stats"><div class="stat"><small>Entradas lançadas</small><strong>${money(income)}</strong></div><div class="stat"><small>Saídas lançadas</small><strong>${money(out)}</strong></div><div class="stat"><small>Saldo dos lançamentos</small><strong>${money(income-out)}</strong></div></div>
  <div class="panel"><h2>Novo lançamento</h2><form id="finance-form" class="grid-form"><label>Tipo<select name="type"><option value="entrada">Entrada</option><option value="saida">Saída</option></select></label><label>Descrição<input name="description" required></label><label>Valor (R$)<input name="amount" type="number" min=".01" step=".01" required></label><label>Vencimento<input name="due_date" type="date"></label><div><button class="action">Registrar</button></div></form></div>
  <div class="panel"><h2>Histórico</h2><div class="table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Valor</th></tr></thead><tbody>${entries.map(x=>`<tr><td>${new Date(x.created_at).toLocaleDateString("pt-BR")}</td><td>${x.type}</td><td>${escapeHtml(x.description)}</td><td>${money(x.amount)}</td></tr>`).join("")||'<tr><td colspan="4">Sem lançamentos.</td></tr>'}</tbody></table></div></div>`;
  $("finance-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.amount=Number(d.amount);try{await request("/finance/entries",{method:"POST",body:JSON.stringify(d)});financePage();}catch(err){alert(err.message);}};
}
async function usersPage(){
  const users=await request("/users"),roles=["Diretor","Gerente","Estoquista","Vendedor","Administrativo"];
  $("page-content").innerHTML=`<div class="panel"><h2>Usuários e setores</h2><p class="notice">Novos cadastros começam como Vendedor. Somente Diretor pode alterar perfis.</p><div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Ação</th></tr></thead><tbody>${users.map(u=>`<tr><td>${escapeHtml(u.full_name)}</td><td>${escapeHtml(u.email)}</td><td><select data-role="${u.id}">${roles.map(r=>`<option ${r===u.role?"selected":""}>${r}</option>`).join("")}</select></td><td>${u.active?"Ativo":"Inativo"}</td><td><button class="action secondary" data-save="${u.id}">Salvar</button></td></tr>`).join("")}</tbody></table></div></div>`;
  document.querySelectorAll("[data-save]").forEach(b=>b.onclick=async()=>{const id=b.dataset.save;try{await request(`/users/${id}`,{method:"PATCH",body:JSON.stringify({role:document.querySelector(`[data-role="${id}"]`).value})});alert("Perfil atualizado.");}catch(e){alert(e.message);}});
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function boot(){if(!token)return;try{const data=await request("/auth/me");currentUser=data.user;showApp();}catch{localStorage.removeItem("sm_token");token=null;}}
boot();
