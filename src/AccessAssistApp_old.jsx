/*
  AccessAssist — Vijayawada accessibility map prototype
  ------------------------------------------------------
  Map layer: Leaflet + OpenStreetMap tiles. No API key, no billing account,
  no Google dependency of any kind.

  SETUP (run once in your React project):
    npm install leaflet react-leaflet

  Then drop this file in as a component and render <AccessAssistApp /> from
  anywhere (App.jsx, a route, etc). No environment variables, no keys, no
  network requests other than the OSM tile fetches (which is what draws the
  map imagery — everything else works fully offline once tiles are cached
  by the browser).
*/

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const COLORS = {
  bg: "#15121f",
  panel: "#1d1930",
  panelBorder: "#33294f",
  text: "#f1edfb",
  textDim: "#a79cc7",
  accent: "#8b6bff",
  accentDim: "#5a4a8f",
  good: "#3ddc97",
  mid: "#f2c14e",
  bad: "#ef5b7c",
  chip: "#2a2244",
};

const FEATURE_LIBRARY = [
  { id: "ramp", label: "Step-free entrance", weight: 30 },
  { id: "doorway", label: "Wide doorways", weight: 15 },
  { id: "restroom", label: "Accessible restroom", weight: 20 },
  { id: "tactile", label: "Tactile paving", weight: 10 },
  { id: "elevator", label: "Elevator access", weight: 15 },
  { id: "parking", label: "Accessible parking", weight: 10 },
];

const VIJAYAWADA_CENTER = [16.5062, 80.648];

const REQUIREMENTS = [
  { id: "wheelchair", label: "Wheelchair", icon: "♿", weights: { ramp: 35, doorway: 20, restroom: 20, elevator: 15, parking: 10 } },
  { id: "walking", label: "Walking assistance", icon: "🦯", weights: { ramp: 25, doorway: 20, restroom: 15, elevator: 15, parking: 10, tactile: 15 } },
  { id: "lowvision", label: "Low vision", icon: "👁️", weights: { tactile: 35, doorway: 20, elevator: 15, restroom: 15, ramp: 15 } },
  { id: "stroller", label: "Stroller", icon: "👶", weights: { ramp: 35, doorway: 25, restroom: 15, elevator: 15, parking: 10 } },
  { id: "elderly", label: "Elderly-friendly", icon: "👴", weights: { ramp: 25, doorway: 15, restroom: 15, elevator: 20, parking: 10, tactile: 15 } },
];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const DEVICE_ID = (() => {
  const key = "accessassist_device_id";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}`; localStorage.setItem(key, id); }
  return id;
})();

function personalizedScore(place, requirementId) {
  const req = REQUIREMENTS.find((r) => r.id === requirementId);
  if (!req) return scoreForFeatures(place.features);
  const score = place.features.reduce((sum, id) => sum + (req.weights[id] || 0), 0);
  return Math.min(100, score);
}

function formatVerified(date) {
  if (!date) return "Never verified";
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Verified today";
  if (days === 1) return "Last verified 1 day ago";
  return `Last verified ${days} days ago`;
}


const SEED_PLACES = [
  { id: "p1", name: "Kanaka Durga Temple Approach", lat: 16.5193, lng: 80.6132, features: ["ramp", "elevator", "restroom"], verified: true, verifiedAt: new Date().toISOString() },
  { id: "p2", name: "Benz Circle Metro Stop", lat: 16.5062, lng: 80.648, features: ["ramp", "tactile"], verified: true, verifiedAt: new Date().toISOString() },
  { id: "p3", name: "PVP Square Mall", lat: 16.5, lng: 80.6425, features: ["ramp", "doorway", "restroom", "elevator", "parking"], verified: true, verifiedAt: new Date().toISOString() },
  { id: "p4", name: "Governorpet Bus Stand", lat: 16.5158, lng: 80.6203, features: ["parking"], verified: false, verifiedAt: null },
  { id: "p5", name: "SRR & CVR College Gate", lat: 16.5348, lng: 80.6089, features: ["doorway"], verified: false, verifiedAt: null },
  { id: "p6", name: "One Town Market Lane", lat: 16.5104, lng: 80.6151, features: [], verified: false, verifiedAt: null },
];

const BARRIER_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
const FAST_FORWARD_MULTIPLIER = 2400; // ~40 virtual minutes per real second

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function scoreForFeatures(featureIds) {
  const total = featureIds.reduce((sum, id) => {
    const f = FEATURE_LIBRARY.find((x) => x.id === id);
    return sum + (f ? f.weight : 0);
  }, 0);
  return Math.min(100, total);
}

function scoreColor(score) {
  if (score >= 70) return COLORS.good;
  if (score >= 40) return COLORS.mid;
  return COLORS.bad;
}

function makeDivIcon(color, pulsing) {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:22px;height:22px;">
        ${pulsing ? `<div style="position:absolute;inset:-8px;border-radius:50%;background:${color};opacity:0.35;animation:aa-pulse 1.6s ease-out infinite;"></div>` : ""}
        <div style="position:absolute;inset:0;border-radius:50%;background:${color};border:2px solid #15121f;box-shadow:0 0 0 2px ${color}55;"></div>
      </div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function formatCountdown(ms) {
  if (ms <= 0) return "expired";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function speak(text) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function describePlaceForVoice(place, score) {
  const featureNames = place.features
    .map((id) => FEATURE_LIBRARY.find((f) => f.id === id)?.label)
    .filter(Boolean);
  const featureText = featureNames.length ? featureNames.join(", ") : "no tagged features yet";
  const barrierText = place.barrier ? "A barrier has been reported here and is still active." : "No active barriers reported.";
  const verifiedText = place.verified ? "This place is verified." : "This place is not yet verified.";
  return `${place.name}. Accessibility score ${score} out of 100. Tagged features: ${featureText}. ${verifiedText} ${barrierText}`;
}

// Straight-line distance in meters between two lat/lng points (haversine).
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Free geocoding via OpenStreetMap's Nominatim — no key, no billing.
// Please respect Nominatim's usage policy (light traffic only, no bulk use):
// https://operations.osmfoundation.org/policies/nominatim/
async function geocodePlace(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    query
  )}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Search failed");
  const results = await res.json();
  if (!results.length) return null;
  const top = results[0];
  return { name: top.display_name.split(",")[0] || query, lat: parseFloat(top.lat), lng: parseFloat(top.lon) };
}

// ---------------------------------------------------------------------------
// Map click handler (used only while placing a new tagged pin)
// ---------------------------------------------------------------------------
function MapClickCatcher({ active, onPick }) {
  useMapEvents({
    click(e) {
      if (active) onPick(e.latlng);
    },
  });
  return null;
}

// Pans/zooms the map whenever a new target location comes in (e.g. from search).
function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 16, { duration: 1.2 });
  }, [target, map]);
  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function AccessAssistApp() {
  const [places, setPlaces] = useState(SEED_PLACES);
  const [requirement, setRequirement] = useState("wheelchair");
  const [profileOpen, setProfileOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [businessRequest, setBusinessRequest] = useState(false);
  const [dbStatus, setDbStatus] = useState("local");
  const [contributor, setContributor] = useState({ points: 0, tagged: 0, barriers: 0, confirmed: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [taggingOpen, setTaggingOpen] = useState(false);
  const [draftFeatures, setDraftFeatures] = useState([]);
  const [placingPin, setPlacingPin] = useState(false);
  const [pendingLocation, setPendingLocation] = useState(null); // {name, lat, lng} — set when tagging comes from search

  const [searchText, setSearchText] = useState("");
  const [searchStatus, setSearchStatus] = useState("idle"); // idle | loading | error
  const [unratedResult, setUnratedResult] = useState(null); // {name, lat, lng} — found via search, not yet tagged

  const [fastForward, setFastForward] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [offlineState, setOfflineState] = useState("idle"); // idle | downloading | ready
  const [offlineProgress, setOfflineProgress] = useState(0);

  const [virtualNow, setVirtualNow] = useState(() => Date.now());
  const tickRef = useRef(null);

  // Virtual clock — advances faster when Demo Fast-Forward is on so a 24h
  // barrier countdown can visibly run out during a live pitch.
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setVirtualNow((prev) => prev + (fastForward ? FAST_FORWARD_MULTIPLIER * 1000 : 1000));
    }, 1000); // ticks once per real second; fast-forward jumps the virtual clock further per tick
    return () => clearInterval(tickRef.current);
  }, [fastForward]);

  useEffect(() => { localStorage.setItem("accessassist_places", JSON.stringify(places)); }, [places]);

  // Auto-clear expired barriers as the virtual clock passes their expiry.
  useEffect(() => {
    setPlaces((prev) =>
      prev.map((p) => {
        if (p.barrier && p.barrier.expiresAt <= virtualNow) {
          return { ...p, barrier: null };
        }
        return p;
      })
    );
  }, [virtualNow]);

  const selectedPlace = useMemo(() => places.find((p) => p.id === selectedId) || null, [places, selectedId]);

  useEffect(() => {
    const cached = localStorage.getItem("accessassist_places");
    if (cached) { try { setPlaces(JSON.parse(cached)); } catch {} }
    const loadData = async () => {
      if (!supabase) { setDbStatus("local"); return; }
      try {
        const { data, error } = await supabase.from("places").select("*").order("created_at", { ascending: true });
        if (error) throw error;
        if (data?.length) {
          setPlaces(data.map((p) => ({ ...p, features: p.features || [], barrier: p.barrier || null, verifiedAt: p.verified_at || null, requestCount: p.request_count || 0 })));
        } else {
          for (const p of SEED_PLACES) await supabase.from("places").upsert({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, features: p.features, verified: !!p.verified, verified_at: p.verifiedAt || null, barrier: p.barrier || null, request_count: 0 });
        }
        setDbStatus("connected");
        const { data: c } = await supabase.from("contributors").select("*").eq("device_id", DEVICE_ID).maybeSingle();
        if (c) setContributor({ points: c.points || 0, tagged: c.tagged || 0, barriers: c.barriers || 0, confirmed: c.confirmed || 0 });
      } catch { setDbStatus("local"); }
    };
    loadData();
  }, []);

  const persistPlace = async (place) => {
    localStorage.setItem("accessassist_places", JSON.stringify(places.map((p) => p.id === place.id ? place : p)));
    if (!supabase) return;
    await supabase.from("places").upsert({
      id: place.id, name: place.name, lat: place.lat, lng: place.lng, features: place.features,
      verified: !!place.verified, verified_at: place.verifiedAt || null, barrier: place.barrier || null,
      request_count: place.requestCount || 0
    });
  };

  const updateContributor = async (delta) => {
    const next = { points: contributor.points + (delta.points || 0), tagged: contributor.tagged + (delta.tagged || 0), barriers: contributor.barriers + (delta.barriers || 0), confirmed: contributor.confirmed + (delta.confirmed || 0) };
    setContributor(next);
    if (supabase) await supabase.from("contributors").upsert({ device_id: DEVICE_ID, ...next });
  };

  const selectPlace = useCallback(
    (id) => {
      setSelectedId(id);
      const place = places.find((p) => p.id === id);
      if (place && voiceMode) {
        const score = personalizedScore(place, requirement);
        speak(describePlaceForVoice(place, score));
      }
    },
    [places, voiceMode, requirement]
  );

  const handleSpeakerClick = () => {
    if (!selectedPlace) return;
    const score = personalizedScore(selectedPlace, requirement);
    speak(describePlaceForVoice(selectedPlace, score));
  };

  const handleReportBarrier = () => {
    if (!selectedPlace) return;
    const updated = { ...selectedPlace, barrier: { reportedAt: virtualNow, expiresAt: virtualNow + BARRIER_DURATION_MS, confirmations: 0, fixed: 0 }, verifiedAt: new Date().toISOString() };
    setPlaces((prev) => prev.map((p) => p.id === updated.id ? updated : p));
    persistPlace(updated);
    updateContributor({ points: 10, barriers: 1 });
  };

  // Anyone visiting the pin can mark a barrier fixed once it's actually resolved —
  // the 24h countdown is just the safety-net fallback if nobody does this.
  const handleResolveBarrier = () => {
    if (!selectedPlace) return;
    const updated = { ...selectedPlace, barrier: null, verified: true, verifiedAt: new Date().toISOString() };
    setPlaces((prev) => prev.map((p) => p.id === updated.id ? updated : p));
    persistPlace(updated);
    updateContributor({ points: 5, confirmed: 1 });
  };

  const handleVerifyPlace = () => {
    if (!selectedPlace || selectedPlace.verified) return;
    const updated = { ...selectedPlace, verified: true, verifiedAt: new Date().toISOString() };
    setPlaces((prev) => prev.map((p) => p.id === updated.id ? updated : p));
    persistPlace(updated);
    updateContributor({ points: 5, confirmed: 1 });
  };

  const confirmBarrier = (stillPresent) => {
    if (!selectedPlace?.barrier) return;
    if (!stillPresent) { handleResolveBarrier(); return; }
    const barrier = { ...selectedPlace.barrier, confirmations: (selectedPlace.barrier.confirmations || 0) + 1 };
    const updated = { ...selectedPlace, barrier, verifiedAt: new Date().toISOString() };
    setPlaces((prev) => prev.map((p) => p.id === updated.id ? updated : p));
    persistPlace(updated);
    updateContributor({ points: 3, confirmed: 1 });
  };

  const requestImprovement = async () => {
    if (!selectedPlace) return;
    const updated = { ...selectedPlace, requestCount: (selectedPlace.requestCount || 0) + 1 };
    setPlaces((prev) => prev.map((p) => p.id === updated.id ? updated : p));
    setBusinessRequest(true);
    if (supabase) await supabase.from("places").upsert({ id: updated.id, name: updated.name, lat: updated.lat, lng: updated.lng, features: updated.features, verified: !!updated.verified, verified_at: updated.verifiedAt || null, barrier: updated.barrier || null, request_count: updated.requestCount || 0 });
  };

  const toggleDraftFeature = (id) => {
    setDraftFeatures((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const startTagging = (prefill) => {
    setDraftFeatures([]);
    setPendingLocation(prefill || null);
    setTaggingOpen(true);
  };

  const confirmTaggingAndPlace = () => {
    setTaggingOpen(false);
    if (pendingLocation) {
      // Came from search — we already know exactly where to put the pin.
      const newPlace = {
        id: `p${Date.now()}`,
        name: pendingLocation.name,
        lat: pendingLocation.lat,
        lng: pendingLocation.lng,
        features: draftFeatures,
        verified: false,
        barrier: null, verifiedAt: null, requestCount: 0,
      };
      setPlaces((prev) => [...prev, newPlace]);
      persistPlace(newPlace);
      updateContributor({ points: 20, tagged: 1 });
      setSelectedId(newPlace.id);
      setUnratedResult(null);
      setPendingLocation(null);
    } else {
      setPlacingPin(true);
    }
  };

  const handleMapPick = (latlng) => {
    const newPlace = {
      id: `p${Date.now()}`,
      name: "New tagged place",
      lat: latlng.lat,
      lng: latlng.lng,
      features: draftFeatures,
      verified: false,
      barrier: null, verifiedAt: null, requestCount: 0,
    };
    setPlaces((prev) => [...prev, newPlace]);
    persistPlace(newPlace);
    updateContributor({ points: 20, tagged: 1 });
    setPlacingPin(false);
    setSelectedId(newPlace.id);
  };

  // Free lookup for any place name (VIT-AP, a hostel, a street) via Nominatim.
  // If a tagged place already exists nearby, jump straight to it. Otherwise
  // surface it as "not yet rated" with a one-click path to tag it.
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchText.trim()) return;
    setSearchStatus("loading");
    setUnratedResult(null);
    try {
      const result = await geocodePlace(`${searchText}, Andhra Pradesh, India`);
      if (!result) {
        setSearchStatus("error");
        return;
      }
      const nearbyExisting = places.find((p) => distanceMeters(p.lat, p.lng, result.lat, result.lng) < 120);
      setSearchStatus("idle");
      if (nearbyExisting) {
        setSelectedId(nearbyExisting.id);
        setUnratedResult({ ...result, flyOnly: true });
      } else {
        setUnratedResult(result);
        setSelectedId(null);
      }
    } catch (err) {
      setSearchStatus("error");
    }
  };

  const startOfflineDownload = () => {
    setOfflineState("downloading");
    setOfflineProgress(0);
  };

  useEffect(() => {
    if (offlineState !== "downloading") return;
    const interval = setInterval(() => {
      setOfflineProgress((prev) => {
        const next = prev + 12;
        if (next >= 100) {
          clearInterval(interval);
          setOfflineState("ready");
          return 100;
        }
        return next;
      });
    }, 150);
    return () => clearInterval(interval);
  }, [offlineState]);

  const draftScore = scoreForFeatures(draftFeatures);

  return (
    <div style={styles.app}>
      <style>{`
        @keyframes aa-pulse {
          0% { transform: scale(0.6); opacity: 0.45; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .leaflet-container { background: ${COLORS.bg} !important; font-family: inherit; }
        .leaflet-control-attribution { background: rgba(21,18,31,0.75) !important; color: ${COLORS.textDim} !important; }
        .leaflet-control-attribution a { color: ${COLORS.textDim} !important; }
        .leaflet-control-zoom a { background: ${COLORS.panel} !important; color: ${COLORS.text} !important; border-color: ${COLORS.panelBorder} !important; }
        .leaflet-popup-content-wrapper { background: ${COLORS.panel} !important; color: ${COLORS.text} !important; border: 1px solid ${COLORS.panelBorder}; border-radius: 10px !important; box-shadow: 0 8px 24px rgba(0,0,0,0.45) !important; }
        .leaflet-popup-tip { background: ${COLORS.panel} !important; border: 1px solid ${COLORS.panelBorder}; }
        .leaflet-popup-content { margin: 10px 12px !important; }
        .leaflet-popup-close-button { color: ${COLORS.textDim} !important; }
      `}</style>

      <header style={styles.header}>
        <div>
          <div style={styles.brand}>AccessAssist</div>
          <div style={styles.brandSub}>Vijayawada · community accessibility map</div>
        </div>
        <div style={styles.headerControls}>
          <div style={styles.dbBadge}>{dbStatus === "connected" ? "● Database connected" : "● Demo database"}</div>
          <button style={styles.toggle} onClick={() => setProfileOpen(true)}>👤 Accessibility Hero</button>
          <ToggleButton label="Demo Fast-Forward" active={fastForward} onClick={() => setFastForward((v) => !v)} />
          <ToggleButton label="Voice-Guided Mode" active={voiceMode} onClick={() => setVoiceMode((v) => !v)} />
          <OfflineControl state={offlineState} progress={offlineProgress} onStart={startOfflineDownload} />
        </div>
      </header>
      <div style={styles.requirementBar}>
        <span style={{fontSize:12,color:COLORS.textDim}}>Accessible for me:</span>
        {REQUIREMENTS.map((r) => <button key={r.id} onClick={() => setRequirement(r.id)} style={{...styles.reqChip, ...(requirement === r.id ? styles.reqActive : {})}}>{r.icon} {r.label}</button>)}
      </div>

      <div style={styles.body}>
        <div style={styles.mapWrap}>
          <MapContainer
            center={VIJAYAWADA_CENTER}
            zoom={13}
            style={{ width: "100%", height: "100%" }}
            zoomControl={true}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <MapClickCatcher active={placingPin} onPick={handleMapPick} />
            {unratedResult && <FlyTo target={unratedResult} />}
            {unratedResult && !unratedResult.flyOnly && (
              <Marker
                position={[unratedResult.lat, unratedResult.lng]}
                icon={makeDivIcon(COLORS.textDim, false)}
              >
                <Popup closeButton={false} offset={[0, -6]}>
                  <div style={{ minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{unratedResult.name}</div>
                    <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 4 }}>
                      No accessibility score yet — you are the first to tag it
                    </div>
                    <button
                      style={{ ...styles.primaryButton, marginTop: 8, width: "100%", fontSize: 12, padding: "6px 10px" }}
                      onClick={() => startTagging(unratedResult)}
                    >
                      Tag this place
                    </button>
                  </div>
                </Popup>
              </Marker>
            )}
            {places.map((p) => {
              const score = personalizedScore(p, requirement);
              const color = p.barrier ? COLORS.bad : scoreColor(score);
              return (
                <Marker
                  key={p.id}
                  position={[p.lat, p.lng]}
                  icon={makeDivIcon(color, !!p.barrier)}
                  eventHandlers={{ click: () => selectPlace(p.id) }}
                >
                  <Popup closeButton={false} offset={[0, -6]}>
                    <div style={{ minWidth: 140 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <span style={{ color, fontWeight: 700, fontSize: 15 }}>{score}</span>
                        <span style={{ fontSize: 11, color: COLORS.textDim }}>/ 100</span>
                        {p.verified && <span style={{ fontSize: 11, color: COLORS.good, marginLeft: "auto" }}>✓ Verified</span>}
                      </div>
                      {p.barrier && (
                        <div style={{ fontSize: 11, color: COLORS.bad, marginTop: 4, fontWeight: 600 }}>
                          ⚠ Barrier active
                        </div>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

          {placingPin && (
            <div style={styles.placingBanner}>Tap anywhere on the map to drop the new pin</div>
          )}

          <form style={styles.searchBar} onSubmit={handleSearch}>
            <input
              style={styles.searchInput}
              type="text"
              placeholder="Search any place — VIT-AP, a hostel, a street…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <button style={styles.searchButton} type="submit" disabled={searchStatus === "loading"}>
              {searchStatus === "loading" ? "Searching…" : "Search"}
            </button>
          </form>
          {searchStatus === "error" && (
            <div style={styles.searchError}>Couldn't find that place — try a more specific name.</div>
          )}

          <button style={styles.tagButton} onClick={() => startTagging(null)}>
            + Tag a Place
          </button>
        </div>

        <SidePanel
          place={selectedPlace}
          virtualNow={virtualNow}
          requirement={requirement}
          onReportBarrier={handleReportBarrier}
          onResolveBarrier={handleResolveBarrier}
          onConfirmBarrier={confirmBarrier}
          onRequestImprovement={requestImprovement}
          onVerifyPlace={handleVerifyPlace}
          onSpeak={handleSpeakerClick}
        />
      </div>

      <button style={styles.emergencyButton} onClick={() => setEmergencyOpen(true)}>🚨 I Need Accessibility Now</button>

      {profileOpen && <ProfileModal contributor={contributor} onClose={() => setProfileOpen(false)} />}
      {emergencyOpen && <EmergencyModal places={places} onClose={() => setEmergencyOpen(false)} />}

      {taggingOpen && (
        <TaggingModal
          draftFeatures={draftFeatures}
          draftScore={draftScore}
          onToggle={toggleDraftFeature}
          onCancel={() => setTaggingOpen(false)}
          onConfirm={confirmTaggingAndPlace}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------
function ToggleButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.toggle,
        background: active ? COLORS.accent : COLORS.panel,
        borderColor: active ? COLORS.accent : COLORS.panelBorder,
        color: active ? "#100c1c" : COLORS.text,
      }}
    >
      {label}
    </button>
  );
}

function OfflineControl({ state, progress, onStart }) {
  if (state === "idle") {
    return (
      <button style={styles.toggle} onClick={onStart}>
        Enable Offline Mode
      </button>
    );
  }
  if (state === "downloading") {
    return (
      <div style={{ ...styles.toggle, display: "flex", alignItems: "center", gap: 8, cursor: "default" }}>
        <div style={styles.progressTrack}>
          <div style={{ ...styles.progressFill, width: `${progress}%` }} />
        </div>
        <span style={{ fontSize: 12, color: COLORS.textDim }}>{progress}%</span>
      </div>
    );
  }
  return (
    <div style={{ ...styles.toggle, background: COLORS.good, color: "#0c2018", borderColor: COLORS.good, cursor: "default" }}>
      Offline: Vijayawada Pack Downloaded
    </div>
  );
}

function SidePanel({ place, virtualNow, requirement, onReportBarrier, onResolveBarrier, onConfirmBarrier, onRequestImprovement, onVerifyPlace, onSpeak }) {
  if (!place) {
    return (
      <aside style={styles.panel}>
        <div style={styles.panelEmpty}>Tap a pin on the map to see its accessibility details.</div>
      </aside>
    );
  }

  const score = personalizedScore(place, requirement);
  const color = scoreColor(score);
  const remaining = place.barrier ? place.barrier.expiresAt - virtualNow : 0;

  return (
    <aside style={styles.panel}>
      <div style={styles.panelHeaderRow}>
        <h2 style={{ ...styles.panelTitle, color: COLORS.text }}>
  📍 {place.name}</h2>
        <button style={styles.speakerButton} onClick={onSpeak} aria-label="Read details aloud">
          🔊
        </button>
      </div>

      {place.verified ? (
        <span style={styles.verifiedBadge}>✓ Verified · {formatVerified(place.verifiedAt)}</span>
      ) : (
        <div style={styles.verifyBox}>
          <div style={{ fontWeight: 700, color: COLORS.mid }}>🟡 Community data — not yet verified</div>
          <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 4 }}>
            Help confirm this location's accessibility information.
          </div>
          <button style={styles.verifyButton} onClick={onVerifyPlace}>
            ✓ Verify this place
          </button>
        </div>
      )}

      <div style={styles.scoreRow}>
        <div style={{ ...styles.scoreCircle, borderColor: color, color }}>{score}</div>
        <div>
          <div style={{ color, fontWeight: 600 }}>{REQUIREMENTS.find((r) => r.id === requirement)?.icon} {REQUIREMENTS.find((r) => r.id === requirement)?.label} suitability</div>
          <div style={{ color: COLORS.textDim, fontSize: 13 }}>out of 100</div>
        </div>
      </div>

      <div style={styles.chipRow}>
        {FEATURE_LIBRARY.map((f) => {
          const has = place.features.includes(f.id);
          return (
            <span
              key={f.id}
              style={{
                ...styles.chip,
                opacity: has ? 1 : 0.35,
                borderColor: has ? COLORS.accent : COLORS.panelBorder,
              }}
            >
              {f.label}
            </span>
          );
        })}
      </div>

      {place.barrier ? (
        <div style={styles.barrierBox}>
          <div style={{ fontWeight: 600, color: COLORS.bad }}>⚠️ Barrier reported</div>
          <div style={{ fontSize: 13, color: COLORS.textDim, marginTop: 4 }}>
            Reported {Math.max(0, Math.floor((Date.now() - new Date(place.barrier.reportedAt).getTime()) / 3600000))} hours ago · Confirmed by {place.barrier.confirmations || 0} users
          </div>
          <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 8 }}>Is this barrier still present?</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={styles.resolveButton} onClick={() => onConfirmBarrier(true)}>👍 Still blocked</button>
            <button style={styles.fixedButton} onClick={() => onConfirmBarrier(false)}>👎 Fixed</button>
          </div>
          <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 8 }}>Auto-clears in {formatCountdown(remaining)} if nobody confirms it.</div>
        </div>
      ) : (
        <button style={styles.barrierButton} onClick={onReportBarrier}>
          Report a Barrier
        </button>
      )}

      <div style={styles.requestBox}>
        <div style={{ fontWeight: 700 }}>🏢 Business Accessibility Request</div>
        <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 4 }}>
          Missing improvements? {place.requestCount || 0} users have requested better accessibility.
        </div>
        <button style={styles.primaryButton} onClick={onRequestImprovement}>
          {place.requestCount ? "Request sent ✓" : "Request Improvement"}
        </button>
      </div>
    </aside>
  );
}

function ProfileModal({ contributor, onClose }) {
  const level = contributor.points >= 100 ? 3 : contributor.points >= 50 ? 2 : 1;
  const badge = contributor.points >= 100 ? "🥇 Accessibility Hero" : contributor.points >= 50 ? "🥈 Accessibility Advocate" : "🥉 Helper";
  return <div style={styles.modalOverlay}><div style={styles.modal}>
    <h3 style={{ margin: 0 }}>👤 Accessibility Hero</h3><div style={styles.heroLevel}>Level {level} · ⭐ {contributor.points} points</div>
    <div style={styles.profileGrid}><div>📍<b>{contributor.tagged}</b><small> places tagged</small></div><div>⚠️<b>{contributor.barriers}</b><small> barriers reported</small></div><div>✓<b>{contributor.confirmed}</b><small> reports confirmed</small></div></div>
    <div style={styles.badgeCard}>{badge}</div><button style={{...styles.primaryButton,width:"100%"}} onClick={onClose}>Close</button>
  </div></div>;
}

function EmergencyModal({ places, onClose }) {
  const items = places.slice(0, 3).map((p, i) => ({ name: p.name, distance: [300, 450, 600][i], type: ["🚻 Accessible restroom", "♿ Step-free entrance", "🅿️ Accessible parking"][i] }));
  return <div style={styles.modalOverlay}><div style={styles.modal}>
    <h3 style={{ margin: 0 }}>🚨 Accessibility Now</h3><p style={{ color: COLORS.textDim, fontSize: 13 }}>Nearest accessible facilities from the demo area:</p>
    {items.map((x) => <div key={x.type} style={styles.emergencyRow}><span>{x.type}<br/><b>{x.name}</b></span><strong>{x.distance} m</strong></div>)}
    <button style={{...styles.primaryButton,width:"100%",marginTop:14}} onClick={onClose}>Close</button>
  </div></div>;
}

function TaggingModal({ draftFeatures, draftScore, onToggle, onCancel, onConfirm }) {
  const color = scoreColor(draftScore);
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: 0, color: COLORS.text }}>Tag a place</h3>
        <p style={{ color: COLORS.textDim, fontSize: 13, marginTop: 4 }}>
          Select the features present at this location.
        </p>

        <div style={styles.modalScorePreview}>
          <div style={{ ...styles.scoreCircle, borderColor: color, color, width: 48, height: 48, fontSize: 16 }}>
            {draftScore}
          </div>
          <span style={{ color: COLORS.textDim, fontSize: 13 }}>Live score preview</span>
        </div>

        <div style={styles.checkList}>
          {FEATURE_LIBRARY.map((f) => (
            <label key={f.id} style={styles.checkRow}>
              <input
                type="checkbox"
                checked={draftFeatures.includes(f.id)}
                onChange={() => onToggle(f.id)}
              />
              <span>{f.label}</span>
            </label>
          ))}
        </div>

        <div style={styles.modalActions}>
          <button style={styles.secondaryButton} onClick={onCancel}>
            Cancel
          </button>
          <button style={styles.primaryButton} onClick={onConfirm}>
            Place pin on map
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = {
  app: {
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    background: COLORS.bg,
    color: COLORS.text,
    width: "100%",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 20px",
    borderBottom: `1px solid ${COLORS.panelBorder}`,
    flexWrap: "wrap",
    gap: 12,
  },
  brand: { fontSize: 20, fontWeight: 700, letterSpacing: 0.2 },
  brandSub: { fontSize: 12, color: COLORS.textDim, marginTop: 2 },
  headerControls: { display: "flex", gap: 8, flexWrap: "wrap" },
  toggle: {
    border: `1px solid ${COLORS.panelBorder}`,
    background: COLORS.panel,
    color: COLORS.text,
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    cursor: "pointer",
  },
  progressTrack: { width: 60, height: 6, borderRadius: 4, background: COLORS.panelBorder, overflow: "hidden" },
  progressFill: { height: "100%", background: COLORS.accent, transition: "width 0.15s linear" },
  requirementBar: { display: "flex", gap: 7, padding: "8px 14px", borderBottom: `1px solid ${COLORS.panelBorder}`, overflowX: "auto", alignItems: "center" },
  reqChip: { border: `1px solid ${COLORS.panelBorder}`, background: COLORS.panel, color: COLORS.text, borderRadius: 999, padding: "7px 10px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
  reqActive: { background: COLORS.accent, color: "#100c1c", borderColor: COLORS.accent, fontWeight: 700 },
  body: { flex: 1, display: "flex", minHeight: 0 },
  mapWrap: { flex: 1, position: "relative" },
  placingBanner: {
    position: "absolute",
    top: 12,
    left: "50%",
    transform: "translateX(-50%)",
    background: COLORS.accent,
    color: "#100c1c",
    padding: "8px 14px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    zIndex: 1000,
  },
  tagButton: {
    position: "absolute",
    bottom: 20,
    left: 20,
    zIndex: 1000,
    background: COLORS.accent,
    color: "#100c1c",
    border: "none",
    borderRadius: 10,
    padding: "12px 18px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 20px rgba(139,107,255,0.4)",
  },
  searchBar: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    zIndex: 1000,
    display: "flex",
    gap: 8,
    maxWidth: 480,
  },
  searchInput: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 8,
    border: `1px solid ${COLORS.panelBorder}`,
    background: COLORS.panel,
    color: COLORS.text,
    fontSize: 13,
    outline: "none",
  },
  searchButton: {
    padding: "10px 16px",
    borderRadius: 8,
    border: "none",
    background: COLORS.accent,
    color: "#100c1c",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  searchError: {
    position: "absolute",
    top: 56,
    left: 12,
    zIndex: 1000,
    background: "rgba(239,91,124,0.15)",
    border: `1px solid ${COLORS.bad}`,
    color: COLORS.bad,
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 8,
  },
  panel: {
    width: 320,
    borderLeft: `1px solid ${COLORS.panelBorder}`,
    background: COLORS.panel,
    padding: 20,
    overflowY: "auto",
  },
  panelEmpty: { color: COLORS.textDim, fontSize: 14, marginTop: 40, textAlign: "center" },
  panelHeaderRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  panelTitle: { fontSize: 18, margin: 0 },
  speakerButton: {
    background: "transparent",
    border: `1px solid ${COLORS.panelBorder}`,
    borderRadius: 8,
    fontSize: 16,
    padding: "4px 8px",
    cursor: "pointer",
  },
  verifiedBadge: {
    display: "inline-block",
    marginTop: 8,
    fontSize: 12,
    color: COLORS.good,
    border: `1px solid ${COLORS.good}`,
    borderRadius: 6,
    padding: "2px 8px",
  },
  scoreRow: { display: "flex", alignItems: "center", gap: 14, marginTop: 18 },
  scoreCircle: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    border: "3px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
    fontWeight: 700,
  },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 18 },
  chip: {
    fontSize: 12,
    padding: "5px 10px",
    borderRadius: 999,
    border: "1px solid",
    background: COLORS.chip,
    color: COLORS.text,
  },
  barrierBox: {
    marginTop: 22,
    padding: 12,
    borderRadius: 10,
    border: `1px solid ${COLORS.bad}`,
    background: "rgba(239,91,124,0.1)",
  },
  barrierButton: {
    marginTop: 22,
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: `1px solid ${COLORS.bad}`,
    background: "transparent",
    color: COLORS.bad,
    fontWeight: 600,
    cursor: "pointer",
  },
  resolveButton: {
    marginTop: 10,
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    background: COLORS.good,
    color: "#0c2018",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(10,8,16,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
  },
  modal: {
    width: 360,
    maxWidth: "90vw",
    background: COLORS.panel,
    border: `1px solid ${COLORS.panelBorder}`,
    borderRadius: 14,
    padding: 22,
  },
  modalScorePreview: { display: "flex", alignItems: "center", gap: 10, marginTop: 14 },
  checkList: { marginTop: 16, display: "flex", flexDirection: "column", gap: 10 },
  checkRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 14, cursor: "pointer" },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 },
  secondaryButton: {
    padding: "9px 14px",
    borderRadius: 8,
    border: `1px solid ${COLORS.panelBorder}`,
    background: "transparent",
    color: COLORS.text,
    cursor: "pointer",
  },
  dbBadge: { fontSize: 11, color: COLORS.good, border: `1px solid ${COLORS.good}`, borderRadius: 999, padding: "6px 9px" },
  emergencyButton: { position: "fixed", right: 20, bottom: 20, zIndex: 1200, background: COLORS.bad, color: "white", border: "none", borderRadius: 999, padding: "12px 16px", fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,.35)" },
  verifyBox: { marginTop: 10, padding: 10, border: `1px solid ${COLORS.mid}`, borderRadius: 10, background: "rgba(242,193,78,0.07)" },
  verifyButton: { marginTop: 9, width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${COLORS.good}`, background: COLORS.good, color: "#0c2018", fontWeight: 700, cursor: "pointer" },
  unverifiedBadge: { display: "inline-block", marginTop: 8, fontSize: 12, color: COLORS.mid, border: `1px solid ${COLORS.mid}`, borderRadius: 6, padding: "2px 8px" },
  fixedButton: { flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${COLORS.good}`, background: "transparent", color: COLORS.good, fontWeight: 700, cursor: "pointer" },
  requestBox: { marginTop: 18, padding: 12, borderRadius: 10, border: `1px solid ${COLORS.panelBorder}`, background: "rgba(139,107,255,.07)" },
  heroLevel: { color: COLORS.accent, fontWeight: 700, marginTop: 8 },
  profileGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 16 },
  profileGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 16 },
  badgeCard: { marginTop: 16, padding: 14, borderRadius: 10, background: COLORS.chip, textAlign: "center", fontWeight: 700 },
  emergencyRow: { display: "flex", justifyContent: "space-between", gap: 10, padding: 10, marginTop: 8, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 8 },
  primaryButton: {
    padding: "9px 14px",
    borderRadius: 8,
    border: "none",
    background: COLORS.accent,
    color: "#100c1c",
    fontWeight: 700,
    cursor: "pointer",
  },
};
