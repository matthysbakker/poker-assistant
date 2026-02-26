import type { GtoEntry } from "./types";

// ─── Source citation shorthand ────────────────────────────────────────────────
const S = "gto-postflop-rule-engine.md";

// ─── GTO_TABLE ────────────────────────────────────────────────────────────────
//
// Key format:  "${IP|OOP}_${street}_ws${wetScore}${p?}_${handTier}_${nobet|bet}"
//
// WetScore:
//   ws0  = dry/rainbow (no flush draw, no connected)
//   ws0p = dry + paired board (high pair)
//   ws2  = semi-wet
//   ws3  = wet (connected + two-tone)
//   ws4  = monotone
//
// Streets: flop | turn | river
//
// ~120 entries covering the highest-frequency spots.
// Low-frequency or redundant entries fall through to the rule-tree fallback.

export const GTO_TABLE: Map<string, GtoEntry> = new Map([

  // ═══════════════════════════════════════════════════════════════════════════
  // IP  ·  FLOP  ·  ws0 (DRY)
  // ═══════════════════════════════════════════════════════════════════════════
  ["IP_flop_ws0_nut_nobet",         { key: "IP_flop_ws0_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.33, source: `${S} §2` }],
  ["IP_flop_ws0_strong_nobet",      { key: "IP_flop_ws0_strong_nobet",      action: "BET",   frequency: 0.80, sizingFraction: 0.33, source: `${S} §2` }],
  ["IP_flop_ws0_top_pair_gk_nobet", { key: "IP_flop_ws0_top_pair_gk_nobet", action: "BET",   frequency: 0.75, sizingFraction: 0.33, source: `${S} §2` }],
  ["IP_flop_ws0_medium_nobet",      { key: "IP_flop_ws0_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §2` }],
  ["IP_flop_ws0_weak_nobet",        { key: "IP_flop_ws0_weak_nobet",        action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §2` }],
  ["IP_flop_ws0_strong_draw_nobet", { key: "IP_flop_ws0_strong_draw_nobet", action: "BET",   frequency: 0.75, sizingFraction: 0.33, source: `${S} §4` }],
  ["IP_flop_ws0_draw_nobet",        { key: "IP_flop_ws0_draw_nobet",        action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws0_weak_draw_nobet",   { key: "IP_flop_ws0_weak_draw_nobet",   action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws0_air_nobet",         { key: "IP_flop_ws0_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §4` }],

  // IP flop ws0 — facing bet
  ["IP_flop_ws0_nut_bet",           { key: "IP_flop_ws0_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["IP_flop_ws0_strong_bet",        { key: "IP_flop_ws0_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["IP_flop_ws0_top_pair_gk_bet",   { key: "IP_flop_ws0_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["IP_flop_ws0_medium_bet",        { key: "IP_flop_ws0_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["IP_flop_ws0_weak_bet",          { key: "IP_flop_ws0_weak_bet",          action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["IP_flop_ws0_strong_draw_bet",   { key: "IP_flop_ws0_strong_draw_bet",   action: "RAISE", frequency: 0.70, sizingFraction: 2.50, source: `${S} §4` }],
  ["IP_flop_ws0_draw_bet",          { key: "IP_flop_ws0_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws0_weak_draw_bet",     { key: "IP_flop_ws0_weak_draw_bet",     action: "FOLD",  frequency: 0.80, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws0_air_bet",           { key: "IP_flop_ws0_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §4` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // IP  ·  FLOP  ·  ws0p (DRY PAIRED)
  // ═══════════════════════════════════════════════════════════════════════════
  ["IP_flop_ws0p_nut_nobet",         { key: "IP_flop_ws0p_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.33, source: `${S} §2` }],
  ["IP_flop_ws0p_strong_nobet",      { key: "IP_flop_ws0p_strong_nobet",      action: "BET",   frequency: 0.82, sizingFraction: 0.33, source: `${S} §2` }],
  ["IP_flop_ws0p_top_pair_gk_nobet", { key: "IP_flop_ws0p_top_pair_gk_nobet", action: "BET",   frequency: 0.78, sizingFraction: 0.33, source: `${S} §2` }],
  ["IP_flop_ws0p_medium_nobet",      { key: "IP_flop_ws0p_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §2` }],
  ["IP_flop_ws0p_weak_nobet",        { key: "IP_flop_ws0p_weak_nobet",        action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §2` }],
  ["IP_flop_ws0p_strong_draw_nobet", { key: "IP_flop_ws0p_strong_draw_nobet", action: "BET",   frequency: 0.72, sizingFraction: 0.33, source: `${S} §4` }],
  ["IP_flop_ws0p_draw_nobet",        { key: "IP_flop_ws0p_draw_nobet",        action: "CHECK", frequency: 0.70, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws0p_air_nobet",         { key: "IP_flop_ws0p_air_nobet",         action: "CHECK", frequency: 0.88, sizingFraction: 0.00, source: `${S} §4` }],

  // IP flop ws0p — facing bet
  ["IP_flop_ws0p_nut_bet",           { key: "IP_flop_ws0p_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["IP_flop_ws0p_strong_bet",        { key: "IP_flop_ws0p_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["IP_flop_ws0p_top_pair_gk_bet",   { key: "IP_flop_ws0p_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["IP_flop_ws0p_medium_bet",        { key: "IP_flop_ws0p_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["IP_flop_ws0p_air_bet",           { key: "IP_flop_ws0p_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §4` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // IP  ·  FLOP  ·  ws2 (SEMI-WET)
  // ═══════════════════════════════════════════════════════════════════════════
  ["IP_flop_ws2_nut_nobet",         { key: "IP_flop_ws2_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.50, source: `${S} §2` }],
  ["IP_flop_ws2_strong_nobet",      { key: "IP_flop_ws2_strong_nobet",      action: "BET",   frequency: 0.80, sizingFraction: 0.50, source: `${S} §2` }],
  ["IP_flop_ws2_top_pair_gk_nobet", { key: "IP_flop_ws2_top_pair_gk_nobet", action: "BET",   frequency: 0.65, sizingFraction: 0.50, source: `${S} §2` }],
  ["IP_flop_ws2_medium_nobet",      { key: "IP_flop_ws2_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §2` }],
  ["IP_flop_ws2_weak_nobet",        { key: "IP_flop_ws2_weak_nobet",        action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §2` }],
  ["IP_flop_ws2_strong_draw_nobet", { key: "IP_flop_ws2_strong_draw_nobet", action: "BET",   frequency: 0.75, sizingFraction: 0.50, source: `${S} §4` }],
  ["IP_flop_ws2_draw_nobet",        { key: "IP_flop_ws2_draw_nobet",        action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws2_weak_draw_nobet",   { key: "IP_flop_ws2_weak_draw_nobet",   action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws2_air_nobet",         { key: "IP_flop_ws2_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §4` }],

  // IP flop ws2 — facing bet
  ["IP_flop_ws2_nut_bet",           { key: "IP_flop_ws2_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["IP_flop_ws2_strong_bet",        { key: "IP_flop_ws2_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["IP_flop_ws2_top_pair_gk_bet",   { key: "IP_flop_ws2_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["IP_flop_ws2_medium_bet",        { key: "IP_flop_ws2_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["IP_flop_ws2_strong_draw_bet",   { key: "IP_flop_ws2_strong_draw_bet",   action: "RAISE", frequency: 0.70, sizingFraction: 2.50, source: `${S} §4` }],
  ["IP_flop_ws2_draw_bet",          { key: "IP_flop_ws2_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws2_weak_draw_bet",     { key: "IP_flop_ws2_weak_draw_bet",     action: "FOLD",  frequency: 0.80, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws2_air_bet",           { key: "IP_flop_ws2_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §4` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // IP  ·  FLOP  ·  ws3 (WET)
  // ═══════════════════════════════════════════════════════════════════════════
  ["IP_flop_ws3_nut_nobet",         { key: "IP_flop_ws3_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.66, source: `${S} §2` }],
  ["IP_flop_ws3_strong_nobet",      { key: "IP_flop_ws3_strong_nobet",      action: "BET",   frequency: 0.80, sizingFraction: 0.66, source: `${S} §2` }],
  ["IP_flop_ws3_top_pair_gk_nobet", { key: "IP_flop_ws3_top_pair_gk_nobet", action: "BET",   frequency: 0.55, sizingFraction: 0.66, source: `${S} §2` }],
  ["IP_flop_ws3_medium_nobet",      { key: "IP_flop_ws3_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §2` }],
  ["IP_flop_ws3_weak_nobet",        { key: "IP_flop_ws3_weak_nobet",        action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §2` }],
  ["IP_flop_ws3_strong_draw_nobet", { key: "IP_flop_ws3_strong_draw_nobet", action: "BET",   frequency: 0.75, sizingFraction: 0.66, source: `${S} §4` }],
  ["IP_flop_ws3_draw_nobet",        { key: "IP_flop_ws3_draw_nobet",        action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws3_weak_draw_nobet",   { key: "IP_flop_ws3_weak_draw_nobet",   action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws3_air_nobet",         { key: "IP_flop_ws3_air_nobet",         action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §4` }],

  // IP flop ws3 — facing bet
  ["IP_flop_ws3_nut_bet",           { key: "IP_flop_ws3_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["IP_flop_ws3_strong_bet",        { key: "IP_flop_ws3_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["IP_flop_ws3_top_pair_gk_bet",   { key: "IP_flop_ws3_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["IP_flop_ws3_medium_bet",        { key: "IP_flop_ws3_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["IP_flop_ws3_strong_draw_bet",   { key: "IP_flop_ws3_strong_draw_bet",   action: "RAISE", frequency: 0.70, sizingFraction: 2.50, source: `${S} §4` }],
  ["IP_flop_ws3_draw_bet",          { key: "IP_flop_ws3_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws3_weak_draw_bet",     { key: "IP_flop_ws3_weak_draw_bet",     action: "FOLD",  frequency: 0.80, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws3_air_bet",           { key: "IP_flop_ws3_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §4` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // IP  ·  FLOP  ·  ws4 (MONOTONE)
  // ═══════════════════════════════════════════════════════════════════════════
  ["IP_flop_ws4_nut_nobet",         { key: "IP_flop_ws4_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.33, source: `${S} §2` }],
  ["IP_flop_ws4_strong_nobet",      { key: "IP_flop_ws4_strong_nobet",      action: "BET",   frequency: 0.80, sizingFraction: 0.33, source: `${S} §2` }],
  ["IP_flop_ws4_top_pair_gk_nobet", { key: "IP_flop_ws4_top_pair_gk_nobet", action: "BET",   frequency: 0.45, sizingFraction: 0.33, source: `${S} §2` }],
  ["IP_flop_ws4_medium_nobet",      { key: "IP_flop_ws4_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §2` }],
  ["IP_flop_ws4_weak_nobet",        { key: "IP_flop_ws4_weak_nobet",        action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §2` }],
  ["IP_flop_ws4_draw_nobet",        { key: "IP_flop_ws4_draw_nobet",        action: "CHECK", frequency: 0.75, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws4_air_nobet",         { key: "IP_flop_ws4_air_nobet",         action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §4` }],

  // IP flop ws4 — facing bet
  ["IP_flop_ws4_nut_bet",           { key: "IP_flop_ws4_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["IP_flop_ws4_strong_bet",        { key: "IP_flop_ws4_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["IP_flop_ws4_top_pair_gk_bet",   { key: "IP_flop_ws4_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["IP_flop_ws4_medium_bet",        { key: "IP_flop_ws4_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["IP_flop_ws4_draw_bet",          { key: "IP_flop_ws4_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §4` }],
  ["IP_flop_ws4_air_bet",           { key: "IP_flop_ws4_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §4` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // OOP  ·  FLOP  ·  ws0 (DRY)
  // ═══════════════════════════════════════════════════════════════════════════
  ["OOP_flop_ws0_nut_nobet",         { key: "OOP_flop_ws0_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.33, source: `${S} §2` }],
  ["OOP_flop_ws0_strong_nobet",      { key: "OOP_flop_ws0_strong_nobet",      action: "BET",   frequency: 0.65, sizingFraction: 0.33, source: `${S} §2` }],
  ["OOP_flop_ws0_top_pair_gk_nobet", { key: "OOP_flop_ws0_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §2` }],
  ["OOP_flop_ws0_medium_nobet",      { key: "OOP_flop_ws0_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §2` }],
  ["OOP_flop_ws0_weak_nobet",        { key: "OOP_flop_ws0_weak_nobet",        action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §2` }],
  ["OOP_flop_ws0_strong_draw_nobet", { key: "OOP_flop_ws0_strong_draw_nobet", action: "BET",   frequency: 0.65, sizingFraction: 0.33, source: `${S} §4` }],
  ["OOP_flop_ws0_draw_nobet",        { key: "OOP_flop_ws0_draw_nobet",        action: "CHECK", frequency: 0.70, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws0_weak_draw_nobet",   { key: "OOP_flop_ws0_weak_draw_nobet",   action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws0_air_nobet",         { key: "OOP_flop_ws0_air_nobet",         action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §4` }],

  // OOP flop ws0 — facing bet
  ["OOP_flop_ws0_nut_bet",           { key: "OOP_flop_ws0_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["OOP_flop_ws0_strong_bet",        { key: "OOP_flop_ws0_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["OOP_flop_ws0_top_pair_gk_bet",   { key: "OOP_flop_ws0_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["OOP_flop_ws0_medium_bet",        { key: "OOP_flop_ws0_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["OOP_flop_ws0_strong_draw_bet",   { key: "OOP_flop_ws0_strong_draw_bet",   action: "CALL",  frequency: 0.75, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws0_draw_bet",          { key: "OOP_flop_ws0_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws0_weak_draw_bet",     { key: "OOP_flop_ws0_weak_draw_bet",     action: "FOLD",  frequency: 0.80, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws0_air_bet",           { key: "OOP_flop_ws0_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §4` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // OOP  ·  FLOP  ·  ws0p (DRY PAIRED)
  // ═══════════════════════════════════════════════════════════════════════════
  ["OOP_flop_ws0p_nut_nobet",         { key: "OOP_flop_ws0p_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.33, source: `${S} §2` }],
  ["OOP_flop_ws0p_strong_nobet",      { key: "OOP_flop_ws0p_strong_nobet",      action: "BET",   frequency: 0.65, sizingFraction: 0.33, source: `${S} §2` }],
  ["OOP_flop_ws0p_top_pair_gk_nobet", { key: "OOP_flop_ws0p_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §2` }],
  ["OOP_flop_ws0p_medium_nobet",      { key: "OOP_flop_ws0p_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §2` }],
  ["OOP_flop_ws0p_air_nobet",         { key: "OOP_flop_ws0p_air_nobet",         action: "CHECK", frequency: 0.88, sizingFraction: 0.00, source: `${S} §4` }],

  // OOP flop ws0p — facing bet
  ["OOP_flop_ws0p_nut_bet",           { key: "OOP_flop_ws0p_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["OOP_flop_ws0p_strong_bet",        { key: "OOP_flop_ws0p_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["OOP_flop_ws0p_top_pair_gk_bet",   { key: "OOP_flop_ws0p_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["OOP_flop_ws0p_medium_bet",        { key: "OOP_flop_ws0p_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // OOP  ·  FLOP  ·  ws2 (SEMI-WET)
  // ═══════════════════════════════════════════════════════════════════════════
  ["OOP_flop_ws2_nut_nobet",         { key: "OOP_flop_ws2_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.50, source: `${S} §2` }],
  ["OOP_flop_ws2_strong_nobet",      { key: "OOP_flop_ws2_strong_nobet",      action: "BET",   frequency: 0.65, sizingFraction: 0.50, source: `${S} §2` }],
  ["OOP_flop_ws2_top_pair_gk_nobet", { key: "OOP_flop_ws2_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §2` }],
  ["OOP_flop_ws2_medium_nobet",      { key: "OOP_flop_ws2_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §2` }],
  ["OOP_flop_ws2_strong_draw_nobet", { key: "OOP_flop_ws2_strong_draw_nobet", action: "BET",   frequency: 0.65, sizingFraction: 0.50, source: `${S} §4` }],
  ["OOP_flop_ws2_draw_nobet",        { key: "OOP_flop_ws2_draw_nobet",        action: "CHECK", frequency: 0.70, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws2_air_nobet",         { key: "OOP_flop_ws2_air_nobet",         action: "CHECK", frequency: 0.88, sizingFraction: 0.00, source: `${S} §4` }],

  // OOP flop ws2 — facing bet
  ["OOP_flop_ws2_nut_bet",           { key: "OOP_flop_ws2_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["OOP_flop_ws2_strong_bet",        { key: "OOP_flop_ws2_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["OOP_flop_ws2_top_pair_gk_bet",   { key: "OOP_flop_ws2_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["OOP_flop_ws2_medium_bet",        { key: "OOP_flop_ws2_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["OOP_flop_ws2_strong_draw_bet",   { key: "OOP_flop_ws2_strong_draw_bet",   action: "CALL",  frequency: 0.75, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws2_draw_bet",          { key: "OOP_flop_ws2_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws2_air_bet",           { key: "OOP_flop_ws2_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §4` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // OOP  ·  FLOP  ·  ws3 (WET)
  // ═══════════════════════════════════════════════════════════════════════════
  ["OOP_flop_ws3_nut_nobet",         { key: "OOP_flop_ws3_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.66, source: `${S} §2` }],
  ["OOP_flop_ws3_strong_nobet",      { key: "OOP_flop_ws3_strong_nobet",      action: "BET",   frequency: 0.65, sizingFraction: 0.66, source: `${S} §2` }],
  ["OOP_flop_ws3_top_pair_gk_nobet", { key: "OOP_flop_ws3_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §2` }],
  ["OOP_flop_ws3_medium_nobet",      { key: "OOP_flop_ws3_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §2` }],
  ["OOP_flop_ws3_strong_draw_nobet", { key: "OOP_flop_ws3_strong_draw_nobet", action: "RAISE", frequency: 0.70, sizingFraction: 2.50, source: `${S} §4` }],
  ["OOP_flop_ws3_draw_nobet",        { key: "OOP_flop_ws3_draw_nobet",        action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws3_weak_draw_nobet",   { key: "OOP_flop_ws3_weak_draw_nobet",   action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws3_air_nobet",         { key: "OOP_flop_ws3_air_nobet",         action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §4` }],

  // OOP flop ws3 — facing bet
  ["OOP_flop_ws3_nut_bet",           { key: "OOP_flop_ws3_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["OOP_flop_ws3_strong_bet",        { key: "OOP_flop_ws3_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["OOP_flop_ws3_top_pair_gk_bet",   { key: "OOP_flop_ws3_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["OOP_flop_ws3_medium_bet",        { key: "OOP_flop_ws3_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["OOP_flop_ws3_strong_draw_bet",   { key: "OOP_flop_ws3_strong_draw_bet",   action: "CALL",  frequency: 0.75, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws3_draw_bet",          { key: "OOP_flop_ws3_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws3_weak_draw_bet",     { key: "OOP_flop_ws3_weak_draw_bet",     action: "FOLD",  frequency: 0.80, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws3_air_bet",           { key: "OOP_flop_ws3_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §4` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // OOP  ·  FLOP  ·  ws4 (MONOTONE)
  // ═══════════════════════════════════════════════════════════════════════════
  ["OOP_flop_ws4_nut_nobet",         { key: "OOP_flop_ws4_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.33, source: `${S} §2` }],
  ["OOP_flop_ws4_strong_nobet",      { key: "OOP_flop_ws4_strong_nobet",      action: "BET",   frequency: 0.65, sizingFraction: 0.33, source: `${S} §2` }],
  ["OOP_flop_ws4_top_pair_gk_nobet", { key: "OOP_flop_ws4_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §2` }],
  ["OOP_flop_ws4_medium_nobet",      { key: "OOP_flop_ws4_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §2` }],
  ["OOP_flop_ws4_air_nobet",         { key: "OOP_flop_ws4_air_nobet",         action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §4` }],

  // OOP flop ws4 — facing bet
  ["OOP_flop_ws4_nut_bet",           { key: "OOP_flop_ws4_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["OOP_flop_ws4_strong_bet",        { key: "OOP_flop_ws4_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §3` }],
  ["OOP_flop_ws4_top_pair_gk_bet",   { key: "OOP_flop_ws4_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["OOP_flop_ws4_medium_bet",        { key: "OOP_flop_ws4_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §3` }],
  ["OOP_flop_ws4_draw_bet",          { key: "OOP_flop_ws4_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §4` }],
  ["OOP_flop_ws4_air_bet",           { key: "OOP_flop_ws4_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §4` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // IP  ·  TURN  ·  ws0 (DRY)
  // ═══════════════════════════════════════════════════════════════════════════
  ["IP_turn_ws0_nut_nobet",         { key: "IP_turn_ws0_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.50, source: `${S} §5` }],
  ["IP_turn_ws0_strong_nobet",      { key: "IP_turn_ws0_strong_nobet",      action: "BET",   frequency: 0.80, sizingFraction: 0.50, source: `${S} §5` }],
  ["IP_turn_ws0_top_pair_gk_nobet", { key: "IP_turn_ws0_top_pair_gk_nobet", action: "BET",   frequency: 0.70, sizingFraction: 0.50, source: `${S} §5` }],
  ["IP_turn_ws0_medium_nobet",      { key: "IP_turn_ws0_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws0_weak_nobet",        { key: "IP_turn_ws0_weak_nobet",        action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws0_strong_draw_nobet", { key: "IP_turn_ws0_strong_draw_nobet", action: "BET",   frequency: 0.70, sizingFraction: 0.50, source: `${S} §5` }],
  ["IP_turn_ws0_draw_nobet",        { key: "IP_turn_ws0_draw_nobet",        action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws0_weak_draw_nobet",   { key: "IP_turn_ws0_weak_draw_nobet",   action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws0_air_nobet",         { key: "IP_turn_ws0_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §5` }],

  // IP turn ws0 — facing bet
  ["IP_turn_ws0_nut_bet",           { key: "IP_turn_ws0_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §5` }],
  ["IP_turn_ws0_strong_bet",        { key: "IP_turn_ws0_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §5` }],
  ["IP_turn_ws0_top_pair_gk_bet",   { key: "IP_turn_ws0_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws0_medium_bet",        { key: "IP_turn_ws0_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws0_strong_draw_bet",   { key: "IP_turn_ws0_strong_draw_bet",   action: "RAISE", frequency: 0.70, sizingFraction: 2.50, source: `${S} §5` }],
  ["IP_turn_ws0_draw_bet",          { key: "IP_turn_ws0_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws0_weak_draw_bet",     { key: "IP_turn_ws0_weak_draw_bet",     action: "FOLD",  frequency: 0.80, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws0_air_bet",           { key: "IP_turn_ws0_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §5` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // IP  ·  TURN  ·  ws2 / ws3
  // ═══════════════════════════════════════════════════════════════════════════
  ["IP_turn_ws2_nut_nobet",         { key: "IP_turn_ws2_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.66, source: `${S} §5` }],
  ["IP_turn_ws2_strong_nobet",      { key: "IP_turn_ws2_strong_nobet",      action: "BET",   frequency: 0.80, sizingFraction: 0.66, source: `${S} §5` }],
  ["IP_turn_ws2_top_pair_gk_nobet", { key: "IP_turn_ws2_top_pair_gk_nobet", action: "BET",   frequency: 0.65, sizingFraction: 0.50, source: `${S} §5` }],
  ["IP_turn_ws2_draw_nobet",        { key: "IP_turn_ws2_draw_nobet",        action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws2_air_nobet",         { key: "IP_turn_ws2_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws2_nut_bet",           { key: "IP_turn_ws2_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §5` }],
  ["IP_turn_ws2_top_pair_gk_bet",   { key: "IP_turn_ws2_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws2_draw_bet",          { key: "IP_turn_ws2_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws2_air_bet",           { key: "IP_turn_ws2_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §5` }],

  ["IP_turn_ws3_nut_nobet",         { key: "IP_turn_ws3_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.66, source: `${S} §5` }],
  ["IP_turn_ws3_strong_nobet",      { key: "IP_turn_ws3_strong_nobet",      action: "BET",   frequency: 0.80, sizingFraction: 0.66, source: `${S} §5` }],
  ["IP_turn_ws3_top_pair_gk_nobet", { key: "IP_turn_ws3_top_pair_gk_nobet", action: "CHECK", frequency: 0.60, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws3_strong_draw_nobet", { key: "IP_turn_ws3_strong_draw_nobet", action: "BET",   frequency: 0.70, sizingFraction: 0.66, source: `${S} §5` }],
  ["IP_turn_ws3_draw_nobet",        { key: "IP_turn_ws3_draw_nobet",        action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws3_air_nobet",         { key: "IP_turn_ws3_air_nobet",         action: "CHECK", frequency: 0.88, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws3_nut_bet",           { key: "IP_turn_ws3_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §5` }],
  ["IP_turn_ws3_strong_draw_bet",   { key: "IP_turn_ws3_strong_draw_bet",   action: "RAISE", frequency: 0.70, sizingFraction: 2.50, source: `${S} §5` }],
  ["IP_turn_ws3_draw_bet",          { key: "IP_turn_ws3_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §5` }],
  ["IP_turn_ws3_air_bet",           { key: "IP_turn_ws3_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §5` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // OOP  ·  TURN  ·  ws0 (DRY)
  // ═══════════════════════════════════════════════════════════════════════════
  ["OOP_turn_ws0_nut_nobet",         { key: "OOP_turn_ws0_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.50, source: `${S} §5` }],
  ["OOP_turn_ws0_strong_nobet",      { key: "OOP_turn_ws0_strong_nobet",      action: "BET",   frequency: 0.65, sizingFraction: 0.50, source: `${S} §5` }],
  ["OOP_turn_ws0_top_pair_gk_nobet", { key: "OOP_turn_ws0_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws0_medium_nobet",      { key: "OOP_turn_ws0_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws0_draw_nobet",        { key: "OOP_turn_ws0_draw_nobet",        action: "CHECK", frequency: 0.70, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws0_air_nobet",         { key: "OOP_turn_ws0_air_nobet",         action: "CHECK", frequency: 0.88, sizingFraction: 0.00, source: `${S} §5` }],

  // OOP turn ws0 — facing bet
  ["OOP_turn_ws0_nut_bet",           { key: "OOP_turn_ws0_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §5` }],
  ["OOP_turn_ws0_strong_bet",        { key: "OOP_turn_ws0_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §5` }],
  ["OOP_turn_ws0_top_pair_gk_bet",   { key: "OOP_turn_ws0_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws0_medium_bet",        { key: "OOP_turn_ws0_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws0_strong_draw_bet",   { key: "OOP_turn_ws0_strong_draw_bet",   action: "CALL",  frequency: 0.75, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws0_draw_bet",          { key: "OOP_turn_ws0_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws0_weak_draw_bet",     { key: "OOP_turn_ws0_weak_draw_bet",     action: "FOLD",  frequency: 0.80, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws0_air_bet",           { key: "OOP_turn_ws0_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §5` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // OOP  ·  TURN  ·  ws2 / ws3
  // ═══════════════════════════════════════════════════════════════════════════
  ["OOP_turn_ws2_nut_nobet",         { key: "OOP_turn_ws2_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.66, source: `${S} §5` }],
  ["OOP_turn_ws2_strong_nobet",      { key: "OOP_turn_ws2_strong_nobet",      action: "BET",   frequency: 0.65, sizingFraction: 0.66, source: `${S} §5` }],
  ["OOP_turn_ws2_top_pair_gk_nobet", { key: "OOP_turn_ws2_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws2_draw_nobet",        { key: "OOP_turn_ws2_draw_nobet",        action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws2_air_nobet",         { key: "OOP_turn_ws2_air_nobet",         action: "CHECK", frequency: 0.88, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws2_nut_bet",           { key: "OOP_turn_ws2_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §5` }],
  ["OOP_turn_ws2_top_pair_gk_bet",   { key: "OOP_turn_ws2_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws2_strong_draw_bet",   { key: "OOP_turn_ws2_strong_draw_bet",   action: "CALL",  frequency: 0.75, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws2_air_bet",           { key: "OOP_turn_ws2_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §5` }],

  ["OOP_turn_ws3_nut_nobet",         { key: "OOP_turn_ws3_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.66, source: `${S} §5` }],
  ["OOP_turn_ws3_strong_nobet",      { key: "OOP_turn_ws3_strong_nobet",      action: "BET",   frequency: 0.65, sizingFraction: 0.66, source: `${S} §5` }],
  ["OOP_turn_ws3_strong_draw_nobet", { key: "OOP_turn_ws3_strong_draw_nobet", action: "RAISE", frequency: 0.70, sizingFraction: 2.50, source: `${S} §4` }],
  ["OOP_turn_ws3_draw_nobet",        { key: "OOP_turn_ws3_draw_nobet",        action: "CHECK", frequency: 0.68, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws3_air_nobet",         { key: "OOP_turn_ws3_air_nobet",         action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws3_nut_bet",           { key: "OOP_turn_ws3_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §5` }],
  ["OOP_turn_ws3_strong_draw_bet",   { key: "OOP_turn_ws3_strong_draw_bet",   action: "CALL",  frequency: 0.75, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws3_draw_bet",          { key: "OOP_turn_ws3_draw_bet",          action: "CALL",  frequency: 0.70, sizingFraction: 0.00, source: `${S} §5` }],
  ["OOP_turn_ws3_air_bet",           { key: "OOP_turn_ws3_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §5` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // IP  ·  RIVER  ·  all wet scores — river-specific rules
  // ═══════════════════════════════════════════════════════════════════════════

  // ws0 nobet
  ["IP_river_ws0_nut_nobet",         { key: "IP_river_ws0_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.75, source: `${S} §6` }],
  ["IP_river_ws0_strong_nobet",      { key: "IP_river_ws0_strong_nobet",      action: "BET",   frequency: 0.85, sizingFraction: 0.66, source: `${S} §6` }],
  ["IP_river_ws0_top_pair_gk_nobet", { key: "IP_river_ws0_top_pair_gk_nobet", action: "BET",   frequency: 0.70, sizingFraction: 0.50, source: `${S} §6` }],
  ["IP_river_ws0_medium_nobet",      { key: "IP_river_ws0_medium_nobet",      action: "CHECK", frequency: 0.80, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws0_weak_nobet",        { key: "IP_river_ws0_weak_nobet",        action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws0_draw_nobet",        { key: "IP_river_ws0_draw_nobet",        action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws0_weak_draw_nobet",   { key: "IP_river_ws0_weak_draw_nobet",   action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws0_air_nobet",         { key: "IP_river_ws0_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

  // ws0 facing bet
  ["IP_river_ws0_nut_bet",           { key: "IP_river_ws0_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["IP_river_ws0_strong_bet",        { key: "IP_river_ws0_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["IP_river_ws0_top_pair_gk_bet",   { key: "IP_river_ws0_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws0_medium_bet",        { key: "IP_river_ws0_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws0_weak_bet",          { key: "IP_river_ws0_weak_bet",          action: "FOLD",  frequency: 0.80, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws0_draw_bet",          { key: "IP_river_ws0_draw_bet",          action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws0_air_bet",           { key: "IP_river_ws0_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

  // ws2 nobet/bet
  ["IP_river_ws2_nut_nobet",         { key: "IP_river_ws2_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.75, source: `${S} §6` }],
  ["IP_river_ws2_strong_nobet",      { key: "IP_river_ws2_strong_nobet",      action: "BET",   frequency: 0.85, sizingFraction: 0.66, source: `${S} §6` }],
  ["IP_river_ws2_top_pair_gk_nobet", { key: "IP_river_ws2_top_pair_gk_nobet", action: "BET",   frequency: 0.65, sizingFraction: 0.50, source: `${S} §6` }],
  ["IP_river_ws2_draw_nobet",        { key: "IP_river_ws2_draw_nobet",        action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws2_air_nobet",         { key: "IP_river_ws2_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws2_nut_bet",           { key: "IP_river_ws2_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["IP_river_ws2_top_pair_gk_bet",   { key: "IP_river_ws2_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws2_air_bet",           { key: "IP_river_ws2_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

  // ws3 nobet/bet
  ["IP_river_ws3_nut_nobet",         { key: "IP_river_ws3_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.75, source: `${S} §6` }],
  ["IP_river_ws3_strong_nobet",      { key: "IP_river_ws3_strong_nobet",      action: "BET",   frequency: 0.85, sizingFraction: 0.66, source: `${S} §6` }],
  ["IP_river_ws3_top_pair_gk_nobet", { key: "IP_river_ws3_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws3_draw_nobet",        { key: "IP_river_ws3_draw_nobet",        action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws3_air_nobet",         { key: "IP_river_ws3_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws3_nut_bet",           { key: "IP_river_ws3_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["IP_river_ws3_strong_bet",        { key: "IP_river_ws3_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["IP_river_ws3_top_pair_gk_bet",   { key: "IP_river_ws3_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws3_medium_bet",        { key: "IP_river_ws3_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws3_air_bet",           { key: "IP_river_ws3_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

  // ws4 (monotone river) nobet/bet
  ["IP_river_ws4_nut_nobet",         { key: "IP_river_ws4_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.75, source: `${S} §6` }],
  ["IP_river_ws4_strong_nobet",      { key: "IP_river_ws4_strong_nobet",      action: "BET",   frequency: 0.85, sizingFraction: 0.66, source: `${S} §6` }],
  ["IP_river_ws4_top_pair_gk_nobet", { key: "IP_river_ws4_top_pair_gk_nobet", action: "CHECK", frequency: 0.70, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws4_medium_nobet",      { key: "IP_river_ws4_medium_nobet",      action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws4_air_nobet",         { key: "IP_river_ws4_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws4_nut_bet",           { key: "IP_river_ws4_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["IP_river_ws4_top_pair_gk_bet",   { key: "IP_river_ws4_top_pair_gk_bet",   action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws4_air_bet",           { key: "IP_river_ws4_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

  // ws0p (paired river) nobet/bet
  ["IP_river_ws0p_nut_nobet",         { key: "IP_river_ws0p_nut_nobet",         action: "BET",   frequency: 0.90, sizingFraction: 0.75, source: `${S} §6` }],
  ["IP_river_ws0p_strong_nobet",      { key: "IP_river_ws0p_strong_nobet",      action: "BET",   frequency: 0.85, sizingFraction: 0.66, source: `${S} §6` }],
  ["IP_river_ws0p_top_pair_gk_nobet", { key: "IP_river_ws0p_top_pair_gk_nobet", action: "BET",   frequency: 0.70, sizingFraction: 0.50, source: `${S} §6` }],
  ["IP_river_ws0p_air_nobet",         { key: "IP_river_ws0p_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws0p_nut_bet",           { key: "IP_river_ws0p_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["IP_river_ws0p_top_pair_gk_bet",   { key: "IP_river_ws0p_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["IP_river_ws0p_air_bet",           { key: "IP_river_ws0p_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

  // ═══════════════════════════════════════════════════════════════════════════
  // OOP  ·  RIVER  ·  all wet scores
  // ═══════════════════════════════════════════════════════════════════════════

  // ws0 nobet
  ["OOP_river_ws0_nut_nobet",         { key: "OOP_river_ws0_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.75, source: `${S} §6` }],
  ["OOP_river_ws0_strong_nobet",      { key: "OOP_river_ws0_strong_nobet",      action: "BET",   frequency: 0.75, sizingFraction: 0.66, source: `${S} §6` }],
  ["OOP_river_ws0_top_pair_gk_nobet", { key: "OOP_river_ws0_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws0_medium_nobet",      { key: "OOP_river_ws0_medium_nobet",      action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws0_draw_nobet",        { key: "OOP_river_ws0_draw_nobet",        action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws0_air_nobet",         { key: "OOP_river_ws0_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

  // ws0 facing bet
  ["OOP_river_ws0_nut_bet",           { key: "OOP_river_ws0_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["OOP_river_ws0_strong_bet",        { key: "OOP_river_ws0_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["OOP_river_ws0_top_pair_gk_bet",   { key: "OOP_river_ws0_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws0_medium_bet",        { key: "OOP_river_ws0_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws0_draw_bet",          { key: "OOP_river_ws0_draw_bet",          action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws0_air_bet",           { key: "OOP_river_ws0_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

  // ws2 nobet/bet
  ["OOP_river_ws2_nut_nobet",         { key: "OOP_river_ws2_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.75, source: `${S} §6` }],
  ["OOP_river_ws2_strong_nobet",      { key: "OOP_river_ws2_strong_nobet",      action: "BET",   frequency: 0.75, sizingFraction: 0.66, source: `${S} §6` }],
  ["OOP_river_ws2_top_pair_gk_nobet", { key: "OOP_river_ws2_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws2_air_nobet",         { key: "OOP_river_ws2_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws2_nut_bet",           { key: "OOP_river_ws2_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["OOP_river_ws2_top_pair_gk_bet",   { key: "OOP_river_ws2_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws2_medium_bet",        { key: "OOP_river_ws2_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws2_air_bet",           { key: "OOP_river_ws2_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

  // ws3 nobet/bet
  ["OOP_river_ws3_nut_nobet",         { key: "OOP_river_ws3_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.75, source: `${S} §6` }],
  ["OOP_river_ws3_strong_nobet",      { key: "OOP_river_ws3_strong_nobet",      action: "BET",   frequency: 0.75, sizingFraction: 0.66, source: `${S} §6` }],
  ["OOP_river_ws3_top_pair_gk_nobet", { key: "OOP_river_ws3_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws3_draw_nobet",        { key: "OOP_river_ws3_draw_nobet",        action: "CHECK", frequency: 0.90, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws3_air_nobet",         { key: "OOP_river_ws3_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws3_nut_bet",           { key: "OOP_river_ws3_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["OOP_river_ws3_strong_bet",        { key: "OOP_river_ws3_strong_bet",        action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["OOP_river_ws3_top_pair_gk_bet",   { key: "OOP_river_ws3_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws3_medium_bet",        { key: "OOP_river_ws3_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws3_air_bet",           { key: "OOP_river_ws3_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

  // ws4 nobet/bet
  ["OOP_river_ws4_nut_nobet",         { key: "OOP_river_ws4_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.75, source: `${S} §6` }],
  ["OOP_river_ws4_strong_nobet",      { key: "OOP_river_ws4_strong_nobet",      action: "BET",   frequency: 0.75, sizingFraction: 0.66, source: `${S} §6` }],
  ["OOP_river_ws4_top_pair_gk_nobet", { key: "OOP_river_ws4_top_pair_gk_nobet", action: "CHECK", frequency: 0.70, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws4_air_nobet",         { key: "OOP_river_ws4_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws4_nut_bet",           { key: "OOP_river_ws4_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["OOP_river_ws4_top_pair_gk_bet",   { key: "OOP_river_ws4_top_pair_gk_bet",   action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws4_air_bet",           { key: "OOP_river_ws4_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

  // ws0p nobet/bet
  ["OOP_river_ws0p_nut_nobet",         { key: "OOP_river_ws0p_nut_nobet",         action: "BET",   frequency: 0.80, sizingFraction: 0.75, source: `${S} §6` }],
  ["OOP_river_ws0p_strong_nobet",      { key: "OOP_river_ws0p_strong_nobet",      action: "BET",   frequency: 0.75, sizingFraction: 0.66, source: `${S} §6` }],
  ["OOP_river_ws0p_top_pair_gk_nobet", { key: "OOP_river_ws0p_top_pair_gk_nobet", action: "CHECK", frequency: 0.65, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws0p_air_nobet",         { key: "OOP_river_ws0p_air_nobet",         action: "CHECK", frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws0p_nut_bet",           { key: "OOP_river_ws0p_nut_bet",           action: "RAISE", frequency: 0.85, sizingFraction: 2.50, source: `${S} §6` }],
  ["OOP_river_ws0p_top_pair_gk_bet",   { key: "OOP_river_ws0p_top_pair_gk_bet",   action: "CALL",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws0p_medium_bet",        { key: "OOP_river_ws0p_medium_bet",        action: "FOLD",  frequency: 0.72, sizingFraction: 0.00, source: `${S} §6` }],
  ["OOP_river_ws0p_air_bet",           { key: "OOP_river_ws0p_air_bet",           action: "FOLD",  frequency: 0.85, sizingFraction: 0.00, source: `${S} §6` }],

]);
