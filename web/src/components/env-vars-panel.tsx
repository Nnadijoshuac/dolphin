"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { envVarsApi } from "@/convex/api";
import { convexClient } from "@/providers/convex-provider";
import { toast } from "@/store/use-toast-store";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * The Keys tab: a wallet's own API keys and secrets. (owner, 2026-09-28)
 *
 * "We are not giving anybody free agents" - an agent built here runs on the
 * builder's own keys. They are stored encrypted (convex/envVars.ts) and this
 * panel can never show one back: it lists names and the last four characters,
 * and replacing a key means pasting it again. That is the same promise a
 * hosting provider makes about env vars, and the only honest one.
 */

function errorText(cause: unknown, fallback: string): string {
  const data = (cause as { data?: unknown } | null)?.data;
  return typeof data === "string" ? data : toUserMessage(cause, fallback);
}

const fieldClass =
  "w-full rounded-lg border border-line bg-paper-strong px-2.5 py-1.5 text-[0.82rem] text-ink outline-none";

function Gate({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center">
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[0.76rem] leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

function SignedInVariables({ sessionToken }: { sessionToken: string }) {
  const variables = useQuery(envVarsApi.envVars.list, { sessionToken });
  const setVariable = useAction(envVarsApi.envVars.set);
  const removeVariable = useMutation(envVarsApi.envVars.remove);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await setVariable({ sessionToken, name, value });
      toast.success(`${saved.name} saved. It is encrypted and cannot be shown again.`);
      setName("");
      setValue("");
    } catch (cause) {
      toast.error(errorText(cause, "Could not save that key."));
    } finally {
      setSaving(false);
    }
  };

  /*
   * A PLAIN FORM FIRST, THEN THE KEYS (owner, 2026-10-19: "it should start with add key... name of key,
   * pasting key, just like a normal form, and then save key. Then under it your already existing keys...
   * all those suggestions or quick fill should go out").
   */
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink">Keys</p>
      <form
        className="mt-3 space-y-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Add a key</p>
        <label className="block">
          <span className="mb-1 block text-[0.72rem] text-muted">Key name</span>
          <input
            autoComplete="off"
            className={fieldClass}
            data-1p-ignore
            data-lpignore="true"
            maxLength={40}
            name="dolphin-variable-name"
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this key"
            spellCheck={false}
            value={name}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[0.72rem] text-muted">Key</span>
          <input
            autoComplete="off"
            className={`${fieldClass} secret-field font-mono`}
            data-1p-ignore
            data-lpignore="true"
            name="dolphin-secret"
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste the key"
            spellCheck={false}
            type="text"
            value={value}
          />
        </label>
        <button
          className="flex h-8 w-full items-center justify-center rounded-lg bg-ink !text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-30"
          disabled={saving || name.trim().length < 1 || value.trim().length === 0}
          type="submit"
        >
          <span className="text-canvas">{saving ? "Encrypting…" : "Save key"}</span>
        </button>
        <p className="text-[0.68rem] leading-relaxed text-muted">
          Stored encrypted for this wallet only. Dolphin never shows a key again, and uses it only when your agent runs.
        </p>
      </form>

      <div className="mt-5 border-t border-line/60 pt-4">
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Your keys</p>
        {variables === undefined ? (
          <p className="mt-2 text-[0.78rem] text-muted">Loading your keys…</p>
        ) : variables.length === 0 ? (
          <p className="mt-2 text-[0.78rem] leading-relaxed text-muted">No keys saved yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {variables.map((variable) => (
              <li className="group flex items-center gap-2 rounded-lg bg-paper-muted/70 px-3 py-2" key={variable.name}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8rem] font-medium text-ink">{variable.name}</p>
                  <p className="font-mono text-[0.68rem] text-muted">
                    {variable.last4 ? `••••${variable.last4}` : "••••"} ·{" "}
                    {new Date(variable.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </p>
                </div>
                <button
                  aria-label={`Remove ${variable.name}`}
                  className="rounded-md px-2 py-1 !text-[0.7rem] font-semibold text-muted transition-colors hover:bg-paper hover:text-danger"
                  onClick={async () => {
                    try {
                      await removeVariable({ sessionToken, name: variable.name });
                    } catch (cause) {
                      toast.error(errorText(cause, "Could not remove that key."));
                    }
                  }}
                  type="button"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function EnvVarsPanel() {
  const wallet = useWallet();
  const session = useWalletSession();

  if (!convexClient || session.status === "unavailable") {
    return <Gate body="Keys are not available on this deployment." title="Unavailable" />;
  }
  if (session.status === "wallet-disconnected") {
    return (
      <Gate
        action={
          <button
            className="rounded-full bg-accent px-3 py-1.5 !text-[12px] font-semibold text-ink transition-colors hover:bg-accent-hover"
            onClick={() => void wallet.connect()}
            type="button"
          >
            Connect wallet
          </button>
        }
        body="Your keys belong to your wallet, so they follow you to every agent you build."
        title="Connect a wallet to add keys"
      />
    );
  }
  if (!session.sessionToken) {
    return (
      <Gate
        action={
          <button
            className="rounded-full bg-ink px-3 py-1.5 !text-[12px] font-semibold disabled:opacity-40"
            disabled={session.isSigningIn || session.status === "checking"}
            onClick={() => void session.signIn()}
            type="button"
          >
            <span className="text-canvas">{session.isSigningIn ? "Check your wallet…" : "Sign in"}</span>
          </button>
        }
        body="One signature proves this wallet is yours. It costs nothing and moves no funds."
        title="Sign in to manage keys"
      />
    );
  }
  return <SignedInVariables sessionToken={session.sessionToken} />;
}
