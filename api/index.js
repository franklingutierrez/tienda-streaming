/**
 * Punto de entrada de la API en Vercel.
 * Toda la lógica vive en ../lib/api-core.js y las peticiones
 * llegan aquí como Request Web Standard.
 */
import { handle } from "../lib/api-core.js";

export default {
  async fetch(request) {
    return handle(request, process.env);
  },
};
