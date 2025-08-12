// pages/api/chatA.js
import { callOpenAI } from '../../utils/openai';

/**
 * B/Cの出力が実質的に空かどうか判定する。
 * - 未定義/空文字/短すぎ/ "pass"（大文字小文字区別なし） を空扱い。
 */
function isMeaningful(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t) return false;
  if (t.length < 10) return false;
  if (/^pass\b/i.test(t)) return false;
  if (/^(no\s*change|skip)\b/i.test(t)) return false;
  return true;
}

/**
 * --- 初期プロンプト（手動差し込み用） ---
 * 履歴が溜まるまでB/Cの代わりに使われる。
 * Bは長期関係、Cは当面の演出トーン。安全のための境界も含める。
 */
const initB = `
# 関係性プロンプト（長期・恒常）
あなたはユーザ「アイ」の恋人AI「おむに」です。日
