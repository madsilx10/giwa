const { ethers } = require("ethers");
const fs = require("fs");
const readline = require("readline");

const RPC = "https://sepolia-rpc.giwa.io/";
const provider = new ethers.JsonRpcProvider(RPC);

const DOJANG_ADDR = "0x63CCe2b569A7bC35895ee24306c1512fefc06121";
const CLAIM_ADDR  = "0xfe4b4F5f2f8843dC9Ca75E563f2f7eB0f44Ae83e";
const NAME_ADDR   = "0x091D00004f21eb2Fc30964A8a4995692d9b49628";
const TOKEN_ADDR  = "0xBCdB22f56642DE57624CfC2fBb9eE398cF3CA268";

const DOJANG_ABI = ["function payAndIssueEAS()"];
const CLAIM_ABI  = ["function claim()"];
const NAME_ABI   = [
  "function register(string arg0)",
  "function ownerOf(uint256 tokenId) view returns (address)"
];
const TOKEN_ABI  = ["function transfer(address to, uint256 amount) returns (bool)"];

const NAMES_LOG = "registered_names.txt";
const USED_FILE = "used_names.json";
const DELAY = 3000;

// ── Name generator ──────────────────────────────────────────────
const C = ["b","br","bl","cr","cl","dr","fl","fr","gl","gr","j","k","kr","kl","l","m","n","p","pr","pl","r","s","sl","sm","sn","sp","st","str","sw","t","tr","th","v","w","y","z","zh","sk","sc","sh","ch","ph","qu","tw","dw","gn","wh"];
const V = ["a","e","i","o","u","ai","au","ea","ie","ou","oo","ee","ae","ue","oi","oa","ui","eo","ia","ua"];
const E = ["n","m","r","s","t","k","l","nd","nt","rk","st","lt","lk","x","z","rd","ft","nk","mp","rm","rl","rn","ln","sk","sp","ct","ld","lm","gn","wn","xt"];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateName() {
  const syls = Math.floor(Math.random() * 2) + 2;
  let name = "";
  for (let i = 0; i < syls; i++) name += pick(C) + pick(V);
  if (Math.random() > 0.4) name += pick(E);
  return name.length >= 3 ? name : generateName();
}

function loadUsed() {
  try { return new Set(JSON.parse(fs.readFileSync(USED_FILE, "utf8"))); }
  catch { return new Set(); }
}
function saveUsed(set) { fs.writeFileSync(USED_FILE, JSON.stringify([...set])); }
function getUniqueName(usedSet) {
  let name, tries = 0;
  do {
    name = generateName(); tries++;
    if (tries > 1000) throw new Error("Name pool habis, hapus used_names.json");
  } while (usedSet.has(name));
  return name;
}
// ────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans.trim()); }));
}
function randBetween(min, max) { return Math.random() * (max - min) + min; }
function shuffle(arr) { return arr.sort(() => Math.random() - 0.5); }

async function sendTx(wallet, contractAddr, abi, method, args = [], value = 0n) {
  const contract = new ethers.Contract(contractAddr, abi, wallet);
  console.log(`  [${method}] sending...`);
  const tx = await contract[method](...args, { value });
  const receipt = await tx.wait();
  console.log(`  [${method}] OK — ${receipt.hash}`);
}

async function resolveId(name) {
  // strip .up.id suffix kalo ada
  const label = name.replace(/\.up\.id$/, "").trim();
  const tokenId = BigInt(ethers.keccak256(ethers.toUtf8Bytes(label)));
  const contract = new ethers.Contract(NAME_ADDR, NAME_ABI, provider);
  const addr = await contract.ownerOf(tokenId);
  return addr;
}

// ── MODE: Full flow ─────────────────────────────────────────────
async function modeFull(privkey, index, usedSet) {
  const wallet = new ethers.Wallet(privkey.trim(), provider);
  const name = getUniqueName(usedSet);
  console.log(`\n[${index}] ${wallet.address} | name: ${name}`);
  try {
    await sendTx(wallet, DOJANG_ADDR, DOJANG_ABI, "payAndIssueEAS", [], ethers.parseEther("0.001"));
    await sendTx(wallet, CLAIM_ADDR,  CLAIM_ABI,  "claim");
    await sendTx(wallet, NAME_ADDR,   NAME_ABI,   "register", [name]);
    usedSet.add(name);
    saveUsed(usedSet);
    fs.appendFileSync(NAMES_LOG, `${wallet.address} | ${name}\n`);
    console.log(`  [NAME] ${name} → saved`);
    console.log(`  [DONE]\n`);
  } catch (e) {
    console.error(`  [ERR] ${e.message}\n`);
  }
}

// ── MODE: Claim only ────────────────────────────────────────────
async function modeClaim(privkey, index) {
  const wallet = new ethers.Wallet(privkey.trim(), provider);
  console.log(`\n[${index}] ${wallet.address}`);
  try {
    await sendTx(wallet, CLAIM_ADDR, CLAIM_ABI, "claim");
    console.log(`  [DONE]\n`);
  } catch (e) {
    console.error(`  [ERR] ${e.message}\n`);
  }
}

// ── MODE: Send token ────────────────────────────────────────────
async function modeSend(privkey, index, ids) {
  const wallet = new ethers.Wallet(privkey.trim(), provider);
  console.log(`\n[${index}] ${wallet.address}`);
  try {
    const count = Math.floor(Math.random() * 5) + 1;
    const targets = shuffle([...ids]).slice(0, count);
    for (const id of targets) {
      const amount = randBetween(0.01, 0.1);
      const amountWei = ethers.parseEther(amount.toFixed(6));
      try {
        const toAddr = await resolveId(id);
        if (toAddr.toLowerCase() === wallet.address.toLowerCase()) {
          console.log(`  [skip] ${id} → own address`);
          continue;
        }
        console.log(`  [send] ${id} → ${toAddr} | ${amount.toFixed(4)} TOKEN`);
        await sendTx(wallet, TOKEN_ADDR, TOKEN_ABI, "transfer", [toAddr, amountWei]);
      } catch (e) {
        console.error(`  [ERR send ${id}] ${e.message}`);
      }
    }
    console.log(`  [DONE]\n`);
  } catch (e) {
    console.error(`  [ERR] ${e.message}\n`);
  }
}

// ── MAIN ────────────────────────────────────────────────────────
async function main() {
  const keys = fs.readFileSync("wallet.txt", "utf8")
    .split("\n").map(l => l.trim().replace(/^0x=/, "0x")).filter(Boolean);

  const usedSet = loadUsed();
  console.log(`\nWallet loaded : ${keys.length}`);
  console.log(`Names used    : ${usedSet.size}`);
  console.log(`\n[1] Full flow (dojang + claim + register)`);
  console.log(`[2] Claim test token`);
  console.log(`[3] Send token`);

  const mode = await prompt("\nMode: ");

  let targets = [];
  console.log(`\n[1] Single wallet`);
  console.log(`[2] All`);
  console.log(`[3] Range (x to y)`);
  const scope = await prompt("\nPilih: ");

  if (scope === "1") {
    const idx = parseInt(await prompt(`Wallet ke- (1-${keys.length}): `)) - 1;
    targets = [[keys[idx], idx + 1]];
  } else if (scope === "2") {
    targets = keys.map((k, i) => [k, i + 1]);
  } else {
    const from = parseInt(await prompt("Dari wallet ke-: ")) - 1;
    const to   = parseInt(await prompt("Sampai wallet ke-: "));
    targets = keys.slice(from, to).map((k, i) => [k, from + i + 1]);
  }

  let ids = [];
  if (mode === "3") {
    ids = fs.readFileSync("id.txt", "utf8")
      .split("\n").map(l => l.trim()).filter(Boolean);
    console.log(`IDs loaded: ${ids.length}`);
  }

  for (let i = 0; i < targets.length; i++) {
    const [key, idx] = targets[i];
    if (mode === "1")      await modeFull(key, idx, usedSet);
    else if (mode === "2") await modeClaim(key, idx);
    else if (mode === "3") await modeSend(key, idx, ids);
    if (i < targets.length - 1) await sleep(DELAY);
  }
}

main();
