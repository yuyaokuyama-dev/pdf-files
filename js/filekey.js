// 「同じファイルか」の判定と、元のファイルへの上書き保存。
// ファイル名では判定しない。PC(Chrome/Edge)ではファイルの場所(File System Access のハンドル)で比べ、
// 場所が分からない環境(iPhone の Safari など)では中身のハッシュ(SHA-256)で比べる。

/** ファイルの場所(ハンドル)を取得できる環境か */
export const canPickHandle = () => typeof window.showOpenFilePicker === "function";

/** ファイルの中身から作る識別子(場所が分からない環境の代わりの判定に使う) */
export async function contentKey(bytes) {
  if (!crypto?.subtle) return null; // http などで使えない場合は判定しない
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return "sha256:" + [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PDFを選ぶ(場所が取れる環境ではハンドル付き)。キャンセルは null */
export async function pickPdfWithHandle() {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "PDF・画像", accept: { "application/pdf": [".pdf"], "image/*": [".png", ".jpg", ".jpeg", ".heic", ".webp"] } }],
      excludeAcceptAllOption: false,
      multiple: false,
    });
    return { file: await handle.getFile(), handle };
  } catch (e) {
    if (e?.name === "AbortError") return null;
    throw e;
  }
}

/** 2つのハンドルが同じ場所のファイルか */
export async function sameEntry(a, b) {
  if (!a || !b || typeof a.isSameEntry !== "function") return false;
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
}

/**
 * 履歴などの記録 r が、開こうとしているファイル {handle, key} と同じファイルか。
 * 両方に場所(ハンドル)があれば場所だけで判定し、どちらかに無ければ中身で判定する。
 */
export async function isSameFile(r, { handle, key }) {
  if (handle && r.fileHandle) return sameEntry(r.fileHandle, handle);
  return !!key && r.fileKey === key;
}

/** 書き込みの許可を確認・依頼する(ボタンを押した直後に呼ぶ) */
export async function ensureWritable(handle) {
  const o = { mode: "readwrite" };
  if ((await handle.queryPermission?.(o)) === "granted") return true;
  return (await handle.requestPermission?.(o)) === "granted";
}

/** ハンドルの場所へ上書き保存 */
export async function writeToHandle(handle, bytes) {
  const w = await handle.createWritable();
  await w.write(bytes);
  await w.close();
}
