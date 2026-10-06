import { route } from "../_lib/http.js";

export default route("POST", (s, b, a) => s.changePassword(a, b));
