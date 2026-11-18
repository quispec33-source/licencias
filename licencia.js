// Firma de licencias en el navegador (WebCrypto), compatible con S10.Licencias.ClaveLicencia:
//   S10PRO.<json en base64url>.<firma ECDSA P-256 / SHA-256 en formato IEEE P1363, base64url>
// y cifrado local de la configuración (PBKDF2-SHA256 200 000 iteraciones + AES-GCM).
"use strict";

const Licencias = (() => {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  const ITERACIONES = 200000;
  const utf8 = new TextEncoder();

  function base64(bytes) {
    let s = "";
    const b = new Uint8Array(bytes);
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function desdeBase64(s) {
    const t = atob(s);
    const b = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i);
    return b;
  }
  const base64Url = (bytes) => base64(bytes).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

  /** "h74h3jm8..." → "H74H-3JM8-...": mismo resultado que CodigoEquipo.Formatear. */
  function formatearEquipo(codigo) {
    const n = String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return (n.match(/.{1,4}/g) || []).join("-");
  }

  /** Clave privada PEM (PKCS#8, la que crea el generador de licencias) → CryptoKey para firmar. */
  async function importarPrivada(pem) {
    const texto = String(pem || "");
    if (/BEGIN EC PRIVATE KEY/.test(texto))
      throw new Error("La clave está en formato 'EC PRIVATE KEY'. Use el archivo clave_privada.pem del generador de licencias (PKCS#8).");
    const cuerpo = texto.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
    if (!cuerpo) throw new Error("El archivo no contiene una clave privada.");
    try {
      return await subtle.importKey("pkcs8", desdeBase64(cuerpo), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    } catch (e) {
      throw new Error("No es una clave privada ECDSA P-256 válida.");
    }
  }

  function hoy() {
    const d = new Date();
    const dos = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  }

  /** Firma la licencia de una solicitud (mismos campos que el administrador de escritorio). */
  async function firmar(clavePrivada, { nombre, equipo, id, correo, programa, emitida, vence }) {
    const lic = { n: nombre, q: formatearEquipo(equipo), f: emitida || hoy() };
    if (vence) lic.v = vence;
    lic.e = "PRO";
    lic.i = id;
    if (correo) lic.c = correo;
    lic.p = programa;
    const datos = utf8.encode(JSON.stringify(lic));
    const firma = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, clavePrivada, datos);
    return `S10PRO.${base64Url(datos)}.${base64Url(firma)}`;
  }

  // --- Configuración cifrada con la contraseña ---

  async function derivar(contrasena, sal) {
    const base = await subtle.importKey("raw", utf8.encode(contrasena), "PBKDF2", false, ["deriveKey"]);
    return subtle.deriveKey({ name: "PBKDF2", salt: sal, iterations: ITERACIONES, hash: "SHA-256" }, base,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  /** Cifra un objeto con la contraseña → { sal, iv, datos } en base64. */
  async function cifrar(objeto, contrasena) {
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const clave = await derivar(contrasena, sal);
    const datos = await subtle.encrypt({ name: "AES-GCM", iv }, clave, utf8.encode(JSON.stringify(objeto)));
    return { sal: base64(sal), iv: base64(iv), datos: base64(datos) };
  }

  /** Descifra; null si la contraseña es incorrecta. */
  async function descifrar(sobre, contrasena) {
    try {
      const clave = await derivar(contrasena, desdeBase64(sobre.sal));
      const datos = await subtle.decrypt({ name: "AES-GCM", iv: desdeBase64(sobre.iv) }, clave, desdeBase64(sobre.datos));
      return JSON.parse(new TextDecoder().decode(datos));
    } catch (e) {
      return null;
    }
  }

  const disponible = () => !!subtle;

  /** Hoy + 1 año en yyyy-MM-dd (29/02 → 28/02, como DateOnly.AddYears en el programa). */
  function enUnAnio() {
    const d = new Date();
    const mes = d.getMonth();
    d.setFullYear(d.getFullYear() + 1);
    if (d.getMonth() !== mes) d.setDate(0);
    const dos = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  }

  return { formatearEquipo, importarPrivada, firmar, cifrar, descifrar, disponible, hoy, enUnAnio };
})();
