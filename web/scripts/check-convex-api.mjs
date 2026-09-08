#!/usr/bin/env node
/**
 * ===========================================================================
 * THE GUARD FOR THE DRIFT THAT ALREADY CAUSED AN OUTAGE.
 * ===========================================================================
 *
 * web/src/convex/api.ts declares the Convex functions this website calls, as
 * hand-written type annotations cast over `anyApi`. It does not import the
 * generated `convex/_generated/api` from the repository root, because that
 * would make this project's build reach outside web/ and resolve `convex` from
 * the root node_modules - so the site could not install or build from a clean
 * clone without the mobile app also being installed. That constraint is
 * deliberate and is not what this script argues with.
 *
 * WHAT IT COSTS, ON THE RECORD. On 2026-09-06 every authenticated write in
 * Convex swapped its untrusted `walletAddress` argument for a `sessionToken`.
 * The mobile app was updated in the same commit. web/src/convex/api.ts was not.
 * Because the annotation is hand-written, `tsc --noEmit` passed - it type-checks
 * the site against its own description of the backend, not against the backend
 * - and every hire on the live site failed at runtime with
 *
 *     ArgumentValidationError: Object is missing the required field `sessionToken`
 *
 * The mitigation written in that file is "if convex/*.ts changes the args,
 * change the annotation here in the same commit". That is the rule which had
 * just been broken. A rule is not a guard.
 *
 * ===========================================================================
 * WHAT THIS CHECKS
 * ===========================================================================
 * For every `namespace.functionName` this site declares:
 *
 *   1. EXISTENCE   `convex/<namespace>.ts` exports a function of that name.
 *   2. VISIBILITY  it is a public `query`/`mutation`/`action`, not an
 *                  `internal*` one - calling an internal function from a
 *                  browser fails at runtime, never at compile time.
 *   3. ARGUMENTS   every argument name in the backend's `args:` validator
 *                  appears in the declared TypeScript argument object, and vice
 *                  versa. Names only: this is a text-level check and does not
 *                  attempt to compare TypeScript types with Convex validators.
 *
 * It is intentionally a NAME-LEVEL check. It cannot catch a `v.string()` that
 * became a `v.number()`. It does catch every failure this project has actually
 * had - a renamed function, a removed function, an added required argument, an
 * argument that changed name - which is what the outage above was.
 *
 * Run: npm run check:convex-api   (and in CI, before the build)
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "..");
const convexDir = join(repoRoot, "convex");
const apiFile = join(webRoot, "src", "convex", "api.ts");

/** Convex function kinds that a browser may call. */
const PUBLIC_KINDS = new Set(["query", "mutation", "action"]);

function fail(messages) {
  console.error("\nweb/src/convex/api.ts does not match convex/.\n");
  for (const message of messages) console.error(`  ✗ ${message}`);
  console.error(
    "\nThis is a RUNTIME OUTAGE, not a style issue: the annotations in api.ts are\n" +
      "hand-written, so `tsc` cannot see this and the site will fail in the browser.\n" +
      "Update web/src/convex/api.ts in the same commit as the backend change.\n",
  );
  process.exit(1);
}

/**
 * Removes comments without damaging string literals.
 *
 * Block comments are stripped wholesale - `/*` does not appear inside any
 * string in either tree. Line comments are stripped ONLY when they are a whole
 * line, because `//` also occurs inside every https:// URL in these files, and
 * a naive `\/\/.*$` truncates the line at the URL and takes any closing brace
 * after it with it. That produced a brace-matching failure that reported 14
 * false mismatches on this script's first run.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * Every public function in one convex module, with its declared argument names.
 *
 * Parsed with regular expressions rather than the TypeScript compiler, because
 * this script has to run in web/ where `typescript` is a devDependency but the
 * convex modules it reads are outside the project. The shape it matches is the
 * one every module in convex/ actually uses:
 *
 *     export const name = query({ args: { a: v.string() }, ... })
 */
function readConvexModule(namespace) {
  const path = join(convexDir, `${namespace}.ts`);
  if (!existsSync(path)) return null;

  const source = stripComments(readFileSync(path, "utf8"));
  const functions = new Map();

  const declaration =
    /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(internalQuery|internalMutation|internalAction|query|mutation|action)\s*\(\s*\{/g;

  let match;
  while ((match = declaration.exec(source)) !== null) {
    const [, name, kind] = match;

    /*
     * The args object, found by brace-matching from `args:` rather than by a
     * regex, because validators nest (v.object({ ... }) inside v.array(...))
     * and a non-greedy match would stop at the first inner brace.
     */
    const bodyStart = match.index + match[0].length;
    const argsIndex = source.indexOf("args:", bodyStart);
    const argNames = [];

    if (argsIndex !== -1 && argsIndex < bodyStart + 400) {
      const open = source.indexOf("{", argsIndex);
      if (open !== -1) {
        let depth = 0;
        let end = open;
        for (let i = open; i < source.length; i += 1) {
          if (source[i] === "{") depth += 1;
          else if (source[i] === "}") {
            depth -= 1;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }

        const argsBlock = source.slice(open + 1, end);
        // Top-level keys only: split on depth-zero commas.
        let depth2 = 0;
        let current = "";
        const parts = [];
        for (const char of argsBlock) {
          if (char === "{" || char === "(" || char === "[") depth2 += 1;
          if (char === "}" || char === ")" || char === "]") depth2 -= 1;
          if (char === "," && depth2 === 0) {
            parts.push(current);
            current = "";
          } else current += char;
        }
        parts.push(current);

        for (const part of parts) {
          const key = part.match(/^\s*([A-Za-z0-9_]+)\s*:/);
          if (key) argNames.push(key[1]);
        }
      }
    }

    functions.set(name, { kind, argNames });
  }

  return functions;
}

/**
 * Every `namespace: { fn: Query<{ args }, ...> }` block declared by api.ts.
 *
 * Namespaces are found from the `anyApi as unknown as { ... }` casts; each
 * top-level key inside one is a convex module name.
 */
function readDeclaredApi() {
  const source = readFileSync(apiFile, "utf8");
  const declared = [];

  /*
   * Comments first. Several of them contain example call shapes and the names
   * of functions that were REMOVED (`listAgents`, and hireReadOnlyAgent's
   * argument history), and matching those would report failures for functions
   * this site does not call.
   */
  const code = stripComments(source);

  const namespaceBlock = /^\s{2}([A-Za-z0-9_]+):\s*\{$/gm;
  let match;
  while ((match = namespaceBlock.exec(code)) !== null) {
    const namespace = match[1];

    // The namespace body, by brace matching from this line's `{`.
    const open = code.indexOf("{", match.index);
    let depth = 0;
    let end = open;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === "{") depth += 1;
      else if (code[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    const body = code.slice(open + 1, end);
    const fnDeclaration =
      /([A-Za-z0-9_]+):\s*(Query|Mutation|Action)<\s*([\s\S]*?)>;/g;

    let fn;
    while ((fn = fnDeclaration.exec(body)) !== null) {
      const [, name, kind, generics] = fn;

      /*
       * The FIRST generic parameter is the args object. Split on the top-level
       * comma so a nested object type in the args does not truncate it.
       */
      let depth3 = 0;
      let argsType = "";
      for (const char of generics) {
        if (char === "{" || char === "<" || char === "(" || char === "[") depth3 += 1;
        if (char === "}" || char === ">" || char === ")" || char === "]") depth3 -= 1;
        if (char === "," && depth3 === 0) break;
        argsType += char;
      }

      const argNames = [];
      // Optional args (`name?:`) are recorded as optional so a backend that does
      // not require them is not reported as a mismatch.
      const key = /([A-Za-z0-9_]+)(\??):/g;
      let keyMatch;
      let keyDepth = 0;
      // Only top-level keys of the args object.
      const inner = argsType.trim().replace(/^\{/, "").replace(/\}$/, "");
      let flat = "";
      for (const char of inner) {
        if (char === "{" || char === "<" || char === "(") keyDepth += 1;
        if (char === "}" || char === ">" || char === ")") keyDepth -= 1;
        if (keyDepth === 0) flat += char;
        else flat += " ";
      }
      while ((keyMatch = key.exec(flat)) !== null) {
        argNames.push({ name: keyMatch[1], optional: keyMatch[2] === "?" });
      }

      declared.push({ namespace, name, kind, argNames });
    }
  }

  return declared;
}

const declared = readDeclaredApi();

if (declared.length === 0) {
  fail([
    "parsed 0 function declarations out of web/src/convex/api.ts. The file's shape " +
      "has changed and this script no longer understands it - fix the script rather " +
      "than deleting the check.",
  ]);
}

const problems = [];
const moduleCache = new Map();

for (const entry of declared) {
  if (!moduleCache.has(entry.namespace)) {
    moduleCache.set(entry.namespace, readConvexModule(entry.namespace));
  }
  const backendModule = moduleCache.get(entry.namespace);

  if (backendModule === null) {
    problems.push(
      `convex/${entry.namespace}.ts does not exist, but api.ts declares ${entry.namespace}.${entry.name}`,
    );
    continue;
  }

  const backend = backendModule.get(entry.name);
  if (!backend) {
    problems.push(
      `convex/${entry.namespace}.ts exports no "${entry.name}" (api.ts declares it as a ${entry.kind})`,
    );
    continue;
  }

  if (!PUBLIC_KINDS.has(backend.kind)) {
    problems.push(
      `${entry.namespace}.${entry.name} is an ${backend.kind} - a browser cannot call it, and the failure would be at runtime`,
    );
    continue;
  }

  const backendArgs = new Set(backend.argNames);
  // `paginationOpts` is supplied by Convex's usePaginatedQuery, not by us, and
  // is declared in api.ts for the type without appearing in every handler's
  // explicit args when the module uses paginationOptsValidator.
  const declaredArgs = new Set(entry.argNames.map((arg) => arg.name));

  for (const argName of backendArgs) {
    if (!declaredArgs.has(argName)) {
      problems.push(
        `${entry.namespace}.${entry.name} takes "${argName}" on the backend, and api.ts does not declare it. ` +
          `A call from this site will be rejected with ArgumentValidationError.`,
      );
    }
  }

  for (const arg of entry.argNames) {
    if (!backendArgs.has(arg.name) && !arg.optional) {
      problems.push(
        `${entry.namespace}.${entry.name} declares required argument "${arg.name}" in api.ts, and the backend does not accept it.`,
      );
    }
  }
}

if (problems.length > 0) fail(problems);

console.log(
  `web/src/convex/api.ts matches convex/ — ${declared.length} functions checked across ` +
    `${moduleCache.size} modules.`,
);
