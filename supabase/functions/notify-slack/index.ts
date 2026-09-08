/**
 * Slack へ通知する Supabase Edge Function。
 *
 * 通知するもの:
 *   1. favorites への INSERT   … 会員が「気になる」を押した
 *   2. applications への INSERT … 求人への応募（中途・新卒サイト共通のテーブル）
 *
 * 経路:
 *   対象テーブルへの INSERT
 *     → Supabase の Database Webhook
 *     → この関数（Slack の Webhook URL を秘密として保持）
 *     → Slack の Incoming Webhook
 *
 * 応募は record.source（"jobsite" = 中途 / "shinsotsu" = 新卒）でどちらのサイトかを見分ける。
 * ⚠ 同じ applications テーブルを2サイトで共有しているため、source を見ないと
 *   新卒の応募に中途サイトのURLを出してしまう。
 *
 * なぜ Slack へ直接飛ばさないか:
 *   1. Slack の Incoming Webhook は {"text": ...} 形式しか受け取らない。
 *      Supabase の Webhook がそのまま送る形（type/table/record…）では 400 になる。
 *   2. Slack の Webhook URL は秘密。サイトは Public リポジトリなので絶対に貼れない。
 *      サーバー側のこの関数だけが持つ。
 *
 * ⚠ 未ログインの「気になる」は localStorage にしか無く、ここには届かない。
 *   プライバシーポリシー（第2項・第11項）で「当社が取得することはありません」と
 *   明記しているため、意図的にそうしている。記載を変えない限り通知もできない。
 *
 * ⚠ このファイルに秘密情報を書かないこと。すべて環境変数から読む。
 *   必要な secret: SLACK_WEBHOOK_URL / HOOK_SECRET
 *   （SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で入れる）
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") ?? "";
const HOOK_SECRET       = Deno.env.get("HOOK_SECRET") ?? "";
const SITE_URL          = Deno.env.get("SITE_URL") ?? "https://jobs.agent-best.net/";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

function ok(msg: string) { return new Response(msg, { status: 200 }); }
function ng(msg: string, status: number) { return new Response(msg, { status }); }

async function postToSlack(text: string) {
  if (!SLACK_WEBHOOK_URL) { console.warn("SLACK_WEBHOOK_URL が未設定です"); return; }
  const r = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
  });
  if (!r.ok) console.error("Slack への送信に失敗:", r.status, await r.text());
}

/* 応募元サイトの定義。source は apply.html が送っている値。 */
const SITES: Record<string, { label: string; origin: string; newGrad: boolean }> = {
  shinsotsu: { label: "新卒サイト", origin: "https://shinsotsu.agent-best.net", newGrad: true },
  jobsite:   { label: "中途サイト", origin: "https://jobs.agent-best.net",      newGrad: false },
};

/* 応募（apply.html）の通知。メール通知（Apps Script）と同じ内容を Slack にも流す。 */
async function notifyApplication(r: any) {
  const site = SITES[r?.source] ?? SITES.jobsite;   /* source が無い古いデータは中途扱い */
  const company = r?.company ?? "";
  const jobName = r?.job_name ?? "";
  const from = company && jobName ? `${company}／${jobName}`
             : company || jobName || "求人の指定なし（サイトから直接）";

  const L: string[] = [];
  L.push(`📩 *応募がありました（${site.label}）*`);
  L.push(`• 求人: ${from}`);
  if (r?.job_id) L.push(`• 求人ページ: <${site.origin}/?job=${encodeURIComponent(r.job_id)}|開く>`);
  L.push(`• お名前: ${r?.full_name ?? ""}${r?.kana ? `（${r.kana}）` : ""}`);
  if (r?.grad_year)  L.push(`• 卒業予定年: ${r.grad_year}`);
  if (r?.birth_date) L.push(`• 生年月日: ${r.birth_date}`);
  /* 新卒サイトの同じ欄には「興味のある職種」が入る。ラベルを取り違えないよう出し分ける。 */
  if (r?.experience_job) L.push(`• ${site.newGrad ? "興味のある職種" : "直近の経験職種"}: ${r.experience_job}`);
  if (r?.prefecture)     L.push(`• お住まい: ${r.prefecture}`);
  if (r?.current_salary) L.push(`• 現在の年収: ${r.current_salary}`);
  L.push(`• 連絡先: ${r?.email ?? ""}${r?.phone ? " / " + r.phone : ""}`);
  const wish = [r?.meeting_type, r?.timing, r?.job_hunting_status].filter(Boolean).join(" / ");
  if (wish) L.push(`• ご希望: ${wish}`);
  if (r?.message) L.push(`• ご要望・ご質問: ${String(r.message).replace(/\n/g, " ")}`);
  L.push(r?.user_id ? "• マイページにログイン中の申し込み" : "• 未ログインの申し込み");

  await postToSlack(L.join("\n"));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return ng("method not allowed", 405);

  /* 誰でも叩ける URL なので、合言葉が一致しないものは捨てる。
     これが無いと、外部から偽の通知を流し込まれる。 */
  if (!HOOK_SECRET || req.headers.get("x-hook-secret") !== HOOK_SECRET) {
    return ng("forbidden", 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return ng("bad json", 400); }

  if (body?.table === "applications" && body?.type === "INSERT") {
    await notifyApplication(body?.record ?? {});
    return ok("sent");
  }

  if (body?.table !== "favorites" || body?.type !== "INSERT") {
    return ok("ignored");   /* 対象外のイベントは黙って捨てる */
  }

  const userId: string | undefined = body?.record?.user_id;
  const jobId:  string | undefined = body?.record?.job_id;
  if (!userId || !jobId) return ok("no ids");

  /* 会員のメールアドレス。誰の動きかが分からないと通知の意味がない。 */
  let email = "(取得できず)";
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    if (data?.user?.email) email = data.user.email;
  } catch (e) { console.warn("メールアドレスの取得に失敗", e); }

  /* 連絡してよい相手かどうか。ここが false の人に求人案内を送ってはいけない。 */
  let name = "", consent = false, hasConsentCol = true;
  try {
    const { data, error } = await admin
      .from("profiles").select("full_name,contact_consent").eq("id", userId).maybeSingle();
    if (error) { hasConsentCol = false; }
    else if (data) { name = data.full_name ?? ""; consent = !!data.contact_consent; }
  } catch (e) { console.warn("プロフィールの取得に失敗", e); }

  /* 何件目の★か。1件目と5件目では温度が違う。 */
  let total: number | null = null;
  try {
    const { count } = await admin
      .from("favorites").select("*", { count: "exact", head: true }).eq("user_id", userId);
    total = count ?? null;
  } catch (e) { console.warn("件数の取得に失敗", e); }

  const who = name ? `${name}（${email}）` : email;
  const jobLink = `${SITE_URL}?job=${encodeURIComponent(jobId)}`;
  const consentLine = hasConsentCol
    ? (consent ? "✅ 求人案内の受信に同意あり（連絡できます）"
               : "🚫 受信同意なし（求人案内は送れません）")
    : "⚠️ 受信同意の列が未作成（SUPABASE_SETUP.md の SQL が未実行です）";

  await postToSlack(
    `⭐ *気になる求人が追加されました*\n` +
    `• 会員: ${who}\n` +
    `• 求人: <${jobLink}|${jobId}>\n` +
    `• この会員の「気になる」合計: ${total ?? "?"}件\n` +
    `• ${consentLine}`,
  );

  return ok("sent");
});
