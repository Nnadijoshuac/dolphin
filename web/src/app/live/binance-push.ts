"use client";

import { useEffect, useRef } from "react";

/*
 * PUSHED, NOT POLLED (owner, 2026-10-20: "the back-end just tells the front-end when there's something
 * new"). Binance's public market stream sends a candle the moment it ticks and closes, and a price the
 * moment it moves. The live page asked Binance's REST API for both every 10-15 seconds instead - up to a
 * few hundred requests an hour per viewer, every answer up to 15 seconds old. Now each one is loaded
 * once and then kept current by the stream.
 *
 * One socket per stream name, shared by every panel that watches it and closed when the last one stops:
 * three panels on ETH 15m candles hold one connection, not three. A dropped socket reconnects and tells
 * its listeners, so they can reload whatever passed while it was down.
 */

/** The combined endpoint: one name can carry several streams joined by "/", each message wrapped as { stream, data }. */
const STREAM = "wss://data-stream.binance.vision/stream?streams=";

type Listener = { onData: (data: Record<string, unknown>) => void; onReconnect?: () => void };
type Channel = { socket: WebSocket | null; listeners: Set<Listener>; retry: ReturnType<typeof setTimeout> | null; opened: boolean };

const channels = new Map<string, Channel>();

function open(name: string, channel: Channel) {
  const socket = new WebSocket(`${STREAM}${name}`);
  channel.socket = socket;
  socket.onopen = () => {
    // Every open after the first is a reconnect: whatever passed while it was down was not seen.
    if (channel.opened) channel.listeners.forEach((listener) => listener.onReconnect?.());
    channel.opened = true;
  };
  socket.onmessage = (message) => {
    const { data } = JSON.parse(message.data as string) as { data?: Record<string, unknown> };
    if (data) channel.listeners.forEach((listener) => listener.onData(data));
  };
  socket.onclose = () => {
    if (channels.get(name) === channel && channel.listeners.size > 0) channel.retry = setTimeout(() => open(name, channel), 2_000);
  };
}

function subscribe(name: string, listener: Listener): () => void {
  let channel = channels.get(name);
  if (!channel) {
    channel = { socket: null, listeners: new Set(), retry: null, opened: false };
    channels.set(name, channel);
    open(name, channel);
  }
  channel.listeners.add(listener);
  return () => {
    const current = channels.get(name);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      channels.delete(name);
      if (current.retry) clearTimeout(current.retry);
      current.socket?.close();
    }
  };
}

/** Listen to Binance streams (e.g. "ethusdt@kline_15m", or several joined by "/") while mounted. Null: nothing. */
export function useBinancePush(name: string | null, onData: (data: Record<string, unknown>) => void, onReconnect?: () => void) {
  const handlers = useRef({ onData, onReconnect });
  useEffect(() => {
    handlers.current = { onData, onReconnect };
  });
  useEffect(() => {
    if (!name) return;
    return subscribe(name, {
      onData: (data) => handlers.current.onData(data),
      onReconnect: () => handlers.current.onReconnect?.(),
    });
  }, [name]);
}
