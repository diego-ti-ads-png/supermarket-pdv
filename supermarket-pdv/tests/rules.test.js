import test from "node:test";
import assert from "node:assert/strict";
import { markup, isValidEmail, passwordErrors, isCriticalStock } from "../api/index.js";

test("valida e-mail", () => {
  assert.equal(isValidEmail("loja@exemplo.com.br"), true);
  assert.equal(isValidEmail("nao-e-email"), false);
});
test("exige senha forte com 12 caracteres", () => {
  assert.deepEqual(passwordErrors("SenhaForte!123"), []);
  assert.ok(passwordErrors("fraca").length >= 3);
});
test("calcula markup sobre o custo", () => {
  assert.equal(markup(10, 15), 0.5);
  assert.throws(() => markup(0, 15));
});
test("estoque crítico é quantidade menor ou igual a 3", () => {
  assert.equal(isCriticalStock(3), true);
  assert.equal(isCriticalStock(2), true);
  assert.equal(isCriticalStock(4), false);
});
