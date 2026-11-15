// Compatibilidad entre las partes de Scope Compass (spec §39, D49): un entero que sube solo cuando se rompe la API
// HTTP/WebSocket o el formato de compass/, no en cada versión. /api/health lo informa (hub e Inicio); el addon de
// Godot tiene el suyo (hub_client.gd, PROTOCOL) y la CLI y el Inicio no usan un hub que hable otro.
export const PROTOCOL = 1;
