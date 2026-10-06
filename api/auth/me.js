import { route } from "../_lib/http.js";

export default route("GET", (s, _b, a) => s.me(a));
