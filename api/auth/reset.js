import { route } from "../_lib/http.js";

// step: "request"(本人) / "issue"(管理者がコード発行) / "confirm"(コード+新パスワード)
export default route("POST", (s, b, a) => {
  if (b.step === "confirm") return s.confirmReset(b);
  if (b.step === "issue") return s.issueReset(a, b);
  return s.requestReset(b);
});
