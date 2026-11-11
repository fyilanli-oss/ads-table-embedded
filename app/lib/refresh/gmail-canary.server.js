import {runQueueSilenceAlarm} from "./observability.server.js";

const tokenUrl = "https://oauth2.googleapis.com/token";
const scope = "https://www.googleapis.com/auth/gmail.send";
const mailbox = "dev@adstable.app";
const sendUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailbox)}/messages/send`;
const fail = () => Error("GMAIL_CANARY_UNCONFIRMED");

async function readReply(response) {
  if (!response?.ok || !response.body) {
    if (response?.body) await response.body.cancel();
    throw fail();
  }
  const reader = response.body.getReader();
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) {await reader.cancel(); throw fail();}
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {reader.releaseLock();}
}

/** One Workspace canary message, invoked after the observer reserves delivery. */
export function createGmailCanarySender({environment, fetchFn = globalThis.fetch}) {
  const clientId = environment?.ADSTABLE_GMAIL_CANARY_CLIENT_ID;
  const clientSecret = environment?.ADSTABLE_GMAIL_CANARY_CLIENT_SECRET;
  const refreshToken = environment?.ADSTABLE_GMAIL_CANARY_REFRESH_TOKEN;
  if (typeof fetchFn !== "function" || ![clientId,clientSecret,refreshToken].every(v => typeof v === "string" && /^[\x21-\x7e]{8,4096}$/.test(v))) throw fail();
  let attempted = false;
  return async ({event,signal}) => {
    if (attempted || event?.environment !== "test" || event.rule !== "AL01" || !/^[a-f0-9]{64}$/.test(event.fingerprint ?? "")
      || !(signal instanceof AbortSignal) || signal.aborted) throw fail();
    attempted = true;
    try {
      const token = await readReply(await fetchFn(tokenUrl,{method:"POST",redirect:"error",signal,
        headers:{"content-type":"application/x-www-form-urlencoded"},
        body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:"refresh_token"})}));
      if (signal.aborted || token?.token_type?.toLowerCase() !== "bearer" || typeof token.access_token !== "string"
        || !/^[A-Za-z0-9._~+/-]{16,4096}={0,2}$/.test(token.access_token)
        || (token.scope !== undefined && token.scope !== scope)) throw fail();
      const subject = "AdsTable TEST — Kuyruk kontrolü gecikti";
      const body = "Bu bir AdsTable izleme denemesidir. Test kuyruğunun başarılı kontrol kaydı 120 saniyeyi aştı. Lütfen e-postanın ulaştığını doğrulayın.";
      const message = [`From: ${mailbox}`,`To: ${mailbox}`,`Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
        "MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",Buffer.from(body).toString("base64").match(/.{1,76}/g).join("\r\n"),""].join("\r\n");
      const sent = await readReply(await fetchFn(sendUrl,{method:"POST",redirect:"error",signal,
        headers:{authorization:`Bearer ${token.access_token}`,"content-type":"application/json"},body:JSON.stringify({raw:Buffer.from(message).toString("base64url")})}));
      if (signal.aborted || typeof sent?.id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(sent.id)) throw fail();
      return {accepted:true};
    } catch {throw fail();}
  };
}


export async function runGmailQueueCanary({environment, fetchFn, witnessStore, incidentStore, readReceipt, now, scopeRef, timeoutMs, retentionMs}) {
  const sendNotification = createGmailCanarySender({environment,fetchFn});
  return runQueueSilenceAlarm({incidentStore,readReceipt,now,scopeRef,timeoutMs,retentionMs,sendNotification,
    witnessStore:{
      async read(options) {
        const saved = await witnessStore.read(options);
        if (saved?.state?.environment !== "test") throw fail();
        return saved;
      },
      commit: input => witnessStore.commit(input),
    }});
}
