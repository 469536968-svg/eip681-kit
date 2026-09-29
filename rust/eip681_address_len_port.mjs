// verify.mjs — control-flow port of librustzcash eip681 address validation,
// used ONLY to reason about zodl-inc/zodl-swift-wallet-sdk PR #16's pinned rev.
//
// WHAT THIS IS:  a transcription of three functions read from source at the pin.
// WHAT THIS IS NOT: an execution of the Rust crate. No Rust binary can link on
//   this host (mingw dlltool cannot create import libraries). Every claim below
//   is therefore labelled SOURCE-READ or EXECUTED-PORT and never blended.
//
// Keccak-256 here is self-checked against the official vectors before use.

// ---------------------------------------------------------------- Keccak-256
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const R = [
  [0,36,3,41,18], [1,44,10,45,2], [62,6,43,15,61], [28,55,25,21,56], [27,20,39,8,14],
];
const M = (1n << 64n) - 1n;
const rotl = (x, n) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M;

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    const C = [], D = [];
    for (let x = 0; x < 5; x++) C[x] = A[x][0] ^ A[x][1] ^ A[x][2] ^ A[x][3] ^ A[x][4];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x][y] ^= D[x];
    const B = [[], [], [], [], []];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      B[y][(2 * x + 3 * y) % 5] = rotl(A[x][y], R[x][y]);
    }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      A[x][y] = B[x][y] ^ ((~B[(x + 1) % 5][y] & M) & B[(x + 2) % 5][y]);
    }
    A[0][0] ^= RC[round];
  }
  return A;
}

function keccak256(bytes) {               // legacy Keccak: pad byte 0x01, not SHA-3's 0x06
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] |= 0x80;
  const A = [[0n,0n,0n,0n,0n],[0n,0n,0n,0n,0n],[0n,0n,0n,0n,0n],[0n,0n,0n,0n,0n],[0n,0n,0n,0n,0n]];
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;                          // lanes are little-endian
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      A[i % 5][Math.floor(i / 5)] ^= lane;
    }
    keccakF(A);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = A[i % 5][Math.floor(i / 5)];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return out;
}
const enc = (s) => new TextEncoder().encode(s);
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------- FIXTURE CHECK (blocking)
const VEC = [
  ["", "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"],
  ["abc", "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"],
  ["The quick brown fox jumps over the lazy dog",
   "4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15"],
];
let ok = true;
for (const [m, want] of VEC) {
  const got = hex(keccak256(enc(m)));
  const pass = got === want;
  if (!pass) ok = false;
  console.log(`${pass ? "PASS" : "FAIL"}  keccak256(${JSON.stringify(m).slice(0, 34)}) = ${got}`);
}
if (!ok) { console.log("KECCAK SELF-CHECK FAILED — aborting, do not trust anything below"); process.exit(1); }

// EIP-55 canonical vectors — proves the checksumderivation below is right too.
const EIP55 = [
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
];
const checksum = (lowerNo0x) => {
  const h = hex(keccak256(enc(lowerNo0x)));
  return lowerNo0x.split("").map((c, i) =>
    /[0-9]/.test(c) ? c : (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
};
for (const v of EIP55) {
  const got = "0x" + checksum(v.slice(2).toLowerCase());
  const pass = got === v;
  if (!pass) ok = false;
  console.log(`${pass ? "PASS" : "FAIL"}  EIP-55 ${v} -> ${got}`);
}
if (!ok) { console.log("EIP-55 SELF-CHECK FAILED — aborting"); process.exit(1); }

// ------------------------------------------------ PORT: validate_erc55 (312)
// Source at pin, parse.rs:312-318, literally:
//   snafu::ensure!(self.places.len() == 40,
//       IncorrectEthAddressLenSnafu { len: self.places.len() });
// ... then compare against the checksummed form.
function validate_erc55(places) {
  if (places.length !== 40) return { err: "IncorrectEthAddressLen", len: places.length };
  const lower = places.toLowerCase();
  const want = checksum(lower);
  if (places === want) return { ok: true };
  const reason = places === lower ? "AllLowercase"
    : (places === places.toUpperCase() ? "AllUppercase" : "ChecksumDoesNotMatch");
  return { err: "Erc55Validation", reason };
}

// ------------------------- PORT: to_erc55_validated_string at the PIN (736)
// Source at pin, parse.rs:736-753, literally:
//   if let Err(ValidationError::Erc55Validation { reason }) = hex_digits.validate_erc55() {
//       match reason { AllLowercase|AllUppercase => Ok(...), e => fail() }
//   } else { Ok(...) }
// THE POINT: the pattern matches ONLY the Erc55Validation variant. An
// IncorrectEthAddressLen error is not that variant, so it does not match,
// and control falls into the `else` branch -> Ok(formatted).
function to_erc55_validated_string_PIN(places) {
  const r = validate_erc55(places);
  if (r.err === "Erc55Validation") {
    if (r.reason === "AllLowercase" || r.reason === "AllUppercase") return { ok: true, v: "0x" + places };
    return { ok: false, err: "Erc55Validation/" + r.reason };
  }
  return { ok: true, v: "0x" + places };   // <- also absorbs IncorrectEthAddressLen
}

// --------------------- PORT: same fn after the fix that PR #3062 proposes
// Turning the `if let` into a `match` over all Err variants makes every
// non-checksum failure propagate, including IncorrectEthAddressLen.
function to_erc55_validated_string_FIXED(places) {
  const r = validate_erc55(places);
  if (!r.err) return { ok: true, v: "0x" + places };
  if (r.err === "Erc55Validation" && (r.reason === "AllLowercase" || r.reason === "AllUppercase"))
    return { ok: true, v: "0x" + places };
  return { ok: false, err: r.err + (r.reason ? "/" + r.reason : "") };
}

// ------------------------------------------------ grammar: parse_min(40) at 727
//   let parse_40plus_hex = preceded(tag("0x"), HexDigits::parse_min(40));
// take_while(is_ascii_hexdigit) then require >= 40. Greedy, so 41+ digits all land
// in `places` and the length check above is the ONLY thing guarding them.
const parse40plus = (input) => {
  if (!input.startsWith("0x")) return null;
  const m = /^[0-9a-fA-F]*/.exec(input.slice(2))[0];
  return m.length >= 40 ? m : null;
};

// ------------------------------------------------------------------ THE SWEEP
const base = "4040404040404040404040404040404040404040";   // 40 lowercase digits
let rows = [], acceptedAtPin = 0, acceptedFixed = 0;
for (let n = 38; n <= 64; n++) {
  const places = base.padEnd(n, "4").slice(0, n);
  const parsed = parse40plus("0x" + places);
  if (!parsed) { rows.push([n, "rejected by grammar", "-"]); continue; }
  const pin = to_erc55_validated_string_PIN(parsed);
  const fix = to_erc55_validated_string_FIXED(parsed);
  if (pin.ok) acceptedAtPin++;
  if (fix.ok) acceptedFixed++;
  rows.push([n, pin.ok ? "ACCEPTED" : "rejected", fix.ok ? "ACCEPTED" : "rejected"]);
}
console.log("\n len | to_erc55_validated_string @ PIN | @ PR#3062");
console.log("-----+--------------------------------+-----------");
for (const [n, a, b] of rows) console.log(String(n).padStart(4), "|", a.padEnd(30), "|", b);
console.log(`\n grammar-passing inputs accepted:  PIN ${acceptedAtPin} / FIXED ${acceptedFixed}`);

// ------------------------------------------- the control: a REAL known address
const real = EIP55[1].slice(2);
console.log("\nCONTROL — genuine EIP-55 address (must stay accepted by BOTH):");
console.log("  PIN  :", JSON.stringify(to_erc55_validated_string_PIN(real)));
console.log("  FIXED:", JSON.stringify(to_erc55_validated_string_FIXED(real)));
console.log("CONTROL — same address, over-length by one digit (the defect):");
const over = real + "0";
console.log("  PIN  :", JSON.stringify(to_erc55_validated_string_PIN(over)));
console.log("  FIXED:", JSON.stringify(to_erc55_validated_string_FIXED(over)));
console.log("CONTROL — plain all-lowercase, exactly 40 (must stay accepted):");
console.log("  PIN  :", JSON.stringify(to_erc55_validated_string_PIN(real.toLowerCase())));
console.log("  FIXED:", JSON.stringify(to_erc55_validated_string_FIXED(real.toLowerCase())));
