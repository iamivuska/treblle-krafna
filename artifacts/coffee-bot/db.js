const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const TABLE = "kv_store";

async function get(key) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

async function set(key, value) {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw error;
}

async function del(key) {
  const { error } = await supabase.from(TABLE).delete().eq("key", key);
  if (error) throw error;
}

async function list(prefix) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("key")
    .like("key", `${prefix}%`);
  if (error) throw error;
  return (data ?? []).map((row) => row.key);
}

async function getUser(userId) {
  return get(`user:${userId}`);
}

async function saveUser(userId, data) {
  return set(`user:${userId}`, data);
}

async function getMatches(prefix) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("value")
    .like("key", `${prefix}%`);
  if (error) throw error;
  return (data ?? []).map((row) => row.value).filter(Boolean);
}

async function getRound() {
  const round = await get("meta:round");
  return round ?? 1;
}

async function incrementRound() {
  const current = await getRound();
  const next = current + 1;
  await set("meta:round", next);
  return next;
}

async function getSchedulerConfig() {
  return get("meta:schedulerConfig");
}

async function setSchedulerConfig(config) {
  return set("meta:schedulerConfig", config);
}

async function isSchedulerPaused() {
  const paused = await get("meta:schedulerPaused");
  return paused === true;
}

async function setSchedulerPaused(paused) {
  return set("meta:schedulerPaused", paused);
}

module.exports = {
  get,
  set,
  delete: del,
  list,
  getUser,
  saveUser,
  getMatches,
  getRound,
  incrementRound,
  getSchedulerConfig,
  setSchedulerConfig,
  isSchedulerPaused,
  setSchedulerPaused,
};
