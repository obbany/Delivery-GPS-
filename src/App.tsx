import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L, { LatLngTuple } from 'leaflet';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Square, Search, MapPin, Navigation, Clock, Activity, History as HistoryIcon, Trash2, Map, Crosshair, X, Timer, Zap, Route, Volume2, VolumeX, Navigation2, Compass } from 'lucide-react';

// To fix the default Leaflet marker icons not loading correctly
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// Custom Native-looking Icons for Dark Theme
const createDotIcon = (color: string, shadowColor: string) => {
  return L.divIcon({
    className: 'bg-transparent border-0',
    html: `<div style="width: 20px; height: 20px; background-color: ${color}; border-radius: 50%; border: 3px solid rgba(255,255,255,0.9); box-shadow: 0 0 15px ${shadowColor};"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
};

const pulseIcon = L.divIcon({
  className: 'bg-transparent border-0',
  html: `<div class="relative flex h-8 w-8 items-center justify-center">
           <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-60"></span>
           <span class="relative inline-flex rounded-full h-5 w-5 bg-cyan-500 border-[3px] border-white shadow-[0_0_20px_rgba(6,182,212,0.8)]"></span>
         </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

// Haversine distance in km
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p = 0.017453292519943295; // Math.PI / 180
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p)/2 + 
          c(lat1 * p) * c(lat2 * p) * 
          (1 - c((lon2 - lon1) * p))/2;
  return 12742 * Math.asin(Math.sqrt(a)); // 2 * R; R = 6371 km
}

function calculatePathDistance(path: LatLngTuple[]) {
  if (path.length < 2) return 0;
  let dist = 0;
  for (let i = 1; i < path.length; i++) {
    dist += calculateDistance(path[i-1][0], path[i-1][1], path[i][0], path[i][1]);
  }
  return dist;
}

function getBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadian = Math.PI / 180;
  const toDegree = 180 / Math.PI;
  const dLon = (lon2 - lon1) * toRadian;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRadian);
  const x = Math.cos(lat1 * toRadian) * Math.sin(lat2 * toRadian) - Math.sin(lat1 * toRadian) * Math.cos(lat2 * toRadian) * Math.cos(dLon);
  return (Math.atan2(y, x) * toDegree + 360) % 360;
}

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

interface SavedRoute {
  id: string;
  storeName: string;
  path: LatLngTuple[];
  distanceKm: number;
  dateStr: string;
  durationSec?: number;
}

function MapController({ position, zoom, followUser, pathData }: { position: LatLngTuple | null, zoom: number, followUser: boolean, pathData: LatLngTuple[] | null }) {
  const map = useMap();
  useEffect(() => {
    if (pathData && pathData.length > 0 && !followUser) {
        const validPathData = pathData.filter(p => p && !isNaN(p[0]) && !isNaN(p[1]));
        if (validPathData.length > 0) {
          const bounds = L.latLngBounds(validPathData);
          if (bounds.isValid()) {
             map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 1.5 });
          }
        }
    } 
    else if (position && followUser && !isNaN(position[0]) && !isNaN(position[1])) {
      map.flyTo(position, zoom, { duration: 1.5, easeLinearity: 0.25 });
    }
  }, [position, followUser, map, zoom, pathData]);
  return null;
}

export default function App() {
  const [currentPosition, setCurrentPosition] = useState<LatLngTuple | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [storeNameInput, setStoreNameInput] = useState('');
  const [currentRoute, setCurrentRoute] = useState<LatLngTuple[]>([]);
  
  // Safely initialize state directly from localStorage so on refresh we don't erase it
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(() => {
    const saved = localStorage.getItem('delivery_routes_v3');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved routes.");
        return [];
      }
    }
    return [];
  });
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<SavedRoute | null>(null);
  
  const watcherIdRef = useRef<number | null>(null);
  const [activeTab, setActiveTab] = useState<'record' | 'history'>('record');
  const [followUser, setFollowUser] = useState(true);

  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentSpeedKph, setCurrentSpeedKph] = useState(0);

  const [currentStreetName, setCurrentStreetName] = useState<string>('Searching location...');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);
  
  const lastGeoFetchRef = useRef<number>(0);
  const lastSpokenIndexRef = useRef<number>(0);
  const lastOffRouteTimeRef = useRef<number>(0);
  const lastRecordingDistRef = useRef<number>(0);

  const speak = React.useCallback((text: string) => {
    if (!voiceEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'bn-BD'; // Try Bengali locale
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled]);

  // Timer effect
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRecording && recordingStartTime) {
      interval = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - recordingStartTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording, recordingStartTime]);

  // Save to LocalStorage whenever routes change
  useEffect(() => {
    localStorage.setItem('delivery_routes_v3', JSON.stringify(savedRoutes));
  }, [savedRoutes]);

  // Reverse Geocoding Effect (Throttle to 15s)
  useEffect(() => {
    if (!currentPosition) return;
    const now = Date.now();
    if (now - lastGeoFetchRef.current > 15000) {
      lastGeoFetchRef.current = now;
      fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${currentPosition[0]}&lon=${currentPosition[1]}`)
        .then(res => res.json())
        .then(data => {
           if (data?.name) {
             setCurrentStreetName(data.name);
           } else if (data?.address?.road) {
             setCurrentStreetName(data.address.road);
           } else {
             setCurrentStreetName('অজানা রাস্তা');
           }
        }).catch(e => console.log(e));
    }
  }, [currentPosition]);

  // Voice Navigation Logic (Saved Routes)
  useEffect(() => {
    if (!isNavigating || !currentPosition || !selectedRoute) return;
    
    let closestIdx = 0;
    let minDist = Infinity;
    selectedRoute.path.forEach((pt, idx) => {
       const d = calculateDistance(currentPosition[0], currentPosition[1], pt[0], pt[1]);
       if (d < minDist) { minDist = d; closestIdx = idx; }
    });

    const now = Date.now();
    if (minDist > 0.05) { // 50m off route
       if (now - lastOffRouteTimeRef.current > 30000) {
          speak("আপনি রাস্তার বাইরে আছেন, অনুগ্রহ করে সঠিক রাস্তায় ফিরে আসুন।");
          lastOffRouteTimeRef.current = now;
       }
       return;
    }

    if (closestIdx >= lastSpokenIndexRef.current + 2) {
        const lookAheadIdx = Math.min(closestIdx + 4, selectedRoute.path.length - 1);
        
        if (lookAheadIdx === selectedRoute.path.length - 1) {
          const distToEnd = calculateDistance(currentPosition[0], currentPosition[1], selectedRoute.path[lookAheadIdx][0], selectedRoute.path[lookAheadIdx][1]);
          if (distToEnd < 0.05 && now - lastSpokenIndexRef.current > 60000) {
             speak("আপনি গন্তব্যে পৌঁছে গেছেন।");
             setIsNavigating(false);
             if (watcherIdRef.current !== null) {
               navigator.geolocation.clearWatch(watcherIdRef.current);
               watcherIdRef.current = null;
             }
             return;
          }
        }

        if (closestIdx < selectedRoute.path.length - 6) {
           const currentHeading = getBearing(selectedRoute.path[closestIdx][0], selectedRoute.path[closestIdx][1], selectedRoute.path[closestIdx+2][0], selectedRoute.path[closestIdx+2][1]);
           const nextHeading = getBearing(selectedRoute.path[closestIdx+2][0], selectedRoute.path[closestIdx+2][1], selectedRoute.path[closestIdx+6][0], selectedRoute.path[closestIdx+6][1]);
           
           let diff = nextHeading - currentHeading;
           if (diff < -180) diff += 360;
           if (diff > 180) diff -= 360;

           if (Math.abs(diff) > 35) {
              if (diff > 0) {
                speak("সামনে ডান দিকে মোড় নিন।");
              } else {
                speak("সামনে বাম দিকে মোড় নিন।");
              }
              lastSpokenIndexRef.current = closestIdx;
           } else {
              lastSpokenIndexRef.current = closestIdx - 1; 
           }
        }
    }
  }, [currentPosition, isNavigating, selectedRoute, speak]);

  // Voice distance announcer for live recording
  useEffect(() => {
    if (isRecording) {
      const dist = calculatePathDistance(currentRoute);
      if (dist - lastRecordingDistRef.current >= 0.5) { // every 500m
         speak(`আপনি ${dist.toFixed(1)} কিলোমিটার অতিক্রম করেছেন।`);
         lastRecordingDistRef.current = dist;
      }
    }
  }, [currentRoute, isRecording, speak]);

  // Initial location fetch
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (position?.coords) {
            const lat = Number(position.coords.latitude);
            const lng = Number(position.coords.longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
              setCurrentPosition([lat, lng]);
            }
          }
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            console.warn("Location access denied. Please allow location permissions in your browser.");
          } else {
            console.warn("Location error:", error.message);
          }
        },
        { enableHighAccuracy: true }
      );
    }
  }, []);

  const startRecording = () => {
    if (!storeNameInput.trim()) {
      alert("দয়া করে দোকানের বা ঠিকানার নাম লিখুন (Please enter the destination name).");
      return;
    }
    if (!('geolocation' in navigator)) return;

    setCurrentRoute(currentPosition && !isNaN(currentPosition[0]) ? [currentPosition] : []);
    setIsRecording(true);
    setIsNavigating(false);
    setFollowUser(true);
    setSelectedRoute(null);
    setRecordingStartTime(Date.now());
    setElapsedSeconds(0);
    setCurrentSpeedKph(0);
    lastRecordingDistRef.current = 0;
    
    speak(`যাত্রা শুরু হলো, গন্তব্য ${storeNameInput.trim()}`);

    watcherIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (!pos?.coords) return;
        const lat = Number(pos.coords.latitude);
        const lng = Number(pos.coords.longitude);
        if (isNaN(lat) || isNaN(lng)) return;
        
        if (pos.coords.accuracy > 40) return; // Prevent zig-zag GPS jumps
        
        const newPoint: LatLngTuple = [lat, lng];
        
        // Speed in km/h
        const speedKph = pos.coords.speed && !isNaN(Number(pos.coords.speed)) ? Number(pos.coords.speed) * 3.6 : 0;
        setCurrentSpeedKph(speedKph);
        
        setCurrentPosition(newPoint);

        setCurrentRoute(prev => {
          if (prev.length === 0) return [newPoint];
          const lastPoint = prev[prev.length - 1];
          const dist = calculateDistance(lastPoint[0], lastPoint[1], newPoint[0], newPoint[1]);
          if (dist < 0.01) return prev; // Avoid standing-still drift
          return [...prev, newPoint];
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
           console.warn("Location permission denied.");
           alert("লোকেশন পারমিশন প্রয়োজন। (Location permission needed.)");
           stopRecording();
        } else {
           console.warn("Watch position error:", err.message);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  };

  const stopRecording = () => {
    if (watcherIdRef.current !== null) {
      navigator.geolocation.clearWatch(watcherIdRef.current);
      watcherIdRef.current = null;
    }
    setIsRecording(false);
    
    if (currentRoute.length > 0) {
      const distance = calculatePathDistance(currentRoute);
      const newRoute: SavedRoute = {
        id: Date.now().toString(),
        storeName: storeNameInput.trim(),
        path: currentRoute,
        distanceKm: distance,
        dateStr: new Date().toLocaleString(),
        durationSec: elapsedSeconds
      };
      
      setSavedRoutes(prev => [newRoute, ...prev]);
      setCurrentRoute([]);
      setStoreNameInput('');
      setActiveTab('history');
      setSelectedRoute(newRoute); // Auto-select the newly created route
      setFollowUser(false);
      speak(`রেকর্ডিং সম্পূর্ণ হয়েছে, দূরত্ব ${(distance).toFixed(2)} কিলোমিটার।`);
    }
  };

  const startNav = () => {
    if (!selectedRoute) return;
    setIsRecording(false);
    setIsNavigating(true);
    setFollowUser(true);
    setActiveTab('record');
    lastSpokenIndexRef.current = 0;
    
    speak(`${selectedRoute.storeName} এর দিকে নেভিগেশন শুরু হলো।`);

    if (!('geolocation' in navigator)) return;
    if (watcherIdRef.current !== null) {
      navigator.geolocation.clearWatch(watcherIdRef.current);
    }

    watcherIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (!pos?.coords) return;
        const lat = Number(pos.coords.latitude);
        const lng = Number(pos.coords.longitude);
        if (isNaN(lat) || isNaN(lng)) return;
        
        if (pos.coords.accuracy > 40) return;
        
        const newPoint: LatLngTuple = [lat, lng];
        const speedKph = pos.coords.speed && !isNaN(Number(pos.coords.speed)) ? Number(pos.coords.speed) * 3.6 : 0;
        setCurrentSpeedKph(speedKph);
        setCurrentPosition(newPoint);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
           console.warn("Location permission denied.");
           stopNav();
        } else {
           console.warn("Watch position error:", err.message);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  };

  const stopNav = () => {
    if (watcherIdRef.current !== null) {
      navigator.geolocation.clearWatch(watcherIdRef.current);
      watcherIdRef.current = null;
    }
    setIsNavigating(false);
    speak("নেভিগেশন বন্ধ করা হয়েছে।");
  };

  const currentDistance = calculatePathDistance(currentRoute);

  const filteredRoutes = savedRoutes.filter(r => 
    r.storeName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectRoute = (route: SavedRoute) => {
    setSelectedRoute(route);
    setFollowUser(false);
  };

  const deleteRoute = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if(confirm("Are you sure you want to delete this route?")) {
      setSavedRoutes(prev => prev.filter(r => r.id !== id));
      if (selectedRoute?.id === id) {
        setSelectedRoute(null);
        setFollowUser(true);
      }
    }
  }

  const defaultCenter: LatLngTuple = [23.8103, 90.4125];

  return (
    <div className="w-full h-screen relative bg-slate-900 overflow-hidden text-slate-100 font-sans selection:bg-cyan-500/30">
      
      {/* MAP LAYER (Background) */}
      <div className="absolute inset-0 z-0 bg-slate-950">
        <MapContainer 
          center={currentPosition && !isNaN(currentPosition[0]) && !isNaN(currentPosition[1]) ? currentPosition : defaultCenter} 
          zoom={15} 
          zoomControl={false}
          scrollWheelZoom={true}
          className="w-full h-full"
        >
          {/* Dark Cosmic Map Tiles */}
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />
          
          <MapController 
              position={currentPosition} 
              zoom={16} 
              followUser={followUser} 
              pathData={selectedRoute?.path || null}
          />

          {/* Current Recording Route */}
          {currentRoute.length > 0 && currentRoute.every(p => p && !isNaN(p[0]) && !isNaN(p[1])) && (
            <>
              {/* Glowing effect via multiple polylines */}
              <Polyline positions={currentRoute} pathOptions={{ color: '#06b6d4', weight: 12, opacity: 0.2, lineCap: 'round', lineJoin: 'round' }} />
              <Polyline positions={currentRoute} pathOptions={{ color: '#22d3ee', weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round' }} />
              {currentRoute[0] && !isNaN(currentRoute[0][0]) && <Marker position={currentRoute[0]} icon={createDotIcon('#10b981', 'rgba(16, 185, 129, 0.6)')} />}
            </>
          )}

          {/* Selected Historical Route */}
          {selectedRoute && selectedRoute.path.length > 0 && selectedRoute.path.every(p => p && !isNaN(p[0]) && !isNaN(p[1])) && (
            <>
              <Polyline positions={selectedRoute.path} pathOptions={{ color: '#8b5cf6', weight: 12, opacity: 0.2, lineCap: 'round', lineJoin: 'round' }} />
              <Polyline positions={selectedRoute.path} pathOptions={{ color: '#a78bfa', weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round' }} />
              
              {selectedRoute.path[0] && !isNaN(selectedRoute.path[0][0]) && <Marker position={selectedRoute.path[0]} icon={createDotIcon('#10b981', 'rgba(16, 185, 129, 0.6)')} />} {/* Start */}
              {selectedRoute.path[selectedRoute.path.length - 1] && !isNaN(selectedRoute.path[selectedRoute.path.length - 1][0]) && <Marker position={selectedRoute.path[selectedRoute.path.length - 1]} icon={createDotIcon('#ef4444', 'rgba(239, 68, 68, 0.6)')} />} {/* End */}
            </>
          )}

          {/* Pulse Marker for User Current Position */}
          {currentPosition && !isNaN(currentPosition[0]) && !isNaN(currentPosition[1]) && (isRecording || !selectedRoute) && (
            <Marker position={currentPosition} icon={pulseIcon} />
          )}
        </MapContainer>
        
        {/* Glow Overlay Vignette */}
        <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_150px_rgba(15,23,42,1)] z-10"></div>
      </div>

      {/* FLOATING TOP NAVIGATION (Glassmorphism) */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[400] pointer-events-auto bg-slate-900/40 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] rounded-full p-1.5 flex items-center border border-white/10 overflow-hidden">
        <button 
          onClick={() => { setActiveTab('record'); if(!isNavigating) setSelectedRoute(null); setFollowUser(true); }}
          className={`relative px-6 py-2.5 rounded-full text-sm font-bold transition-all duration-300 ${activeTab === 'record' ? 'text-white' : 'text-slate-400 hover:text-white'}`}
        >
          {activeTab === 'record' && (
             <motion.div layoutId="nav-pill" className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full shadow-[0_0_15px_rgba(6,182,212,0.5)]" transition={{ type: "spring", stiffness: 300, damping: 25 }} />
          )}
          <span className="relative z-10 flex items-center gap-2"><Route className="w-4 h-4"/> Navigator</span>
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          className={`relative px-6 py-2.5 rounded-full text-sm font-bold transition-all duration-300 ${activeTab === 'history' ? 'text-white' : 'text-slate-400 hover:text-white'}`}
        >
          {activeTab === 'history' && (
             <motion.div layoutId="nav-pill" className="absolute inset-0 bg-gradient-to-r from-purple-500 to-fuchsia-600 rounded-full shadow-[0_0_15px_rgba(168,85,247,0.5)]" transition={{ type: "spring", stiffness: 300, damping: 25 }} />
          )}
          <span className="relative z-10 flex items-center gap-2"><HistoryIcon className="w-4 h-4"/> Archives</span>
        </button>
      </div>

      {/* Street indicator */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[300] bg-slate-900/80 backdrop-blur-md px-6 py-2 rounded-full border border-white/10 shadow-xl flex items-center gap-2 pointer-events-none whitespace-nowrap">
        <Compass className="w-4 h-4 text-cyan-400 animate-pulse" />
        <span className="text-white font-bold text-sm tracking-wide">{currentStreetName}</span>
      </div>

      {/* FLOATING CONTROLS PANEL */}
      <div className="absolute inset-0 z-20 pointer-events-none p-0 md:p-6 pb-0 flex flex-col justify-end md:justify-start overflow-hidden">
        
        <AnimatePresence mode="popLayout">
            <motion.div 
            key={activeTab}
            initial={{ y: 50, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="pointer-events-auto md:mt-20 md:ml-4 w-full md:w-[420px] bg-slate-900/60 backdrop-blur-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] rounded-t-[2.5rem] md:rounded-3xl border border-white/10 flex flex-col transition-all overflow-hidden"
            style={{ maxHeight: activeTab === 'record' && isRecording ? 'auto' : (activeTab === 'record' ? 'auto' : '65vh') }}
          >
            {/* Mobile swipe indicator */}
            <div className="w-full flex justify-center pt-4 pb-2 md:hidden">
              <div className="w-12 h-1 bg-slate-700 rounded-full"></div>
            </div>

            {/* RECORD TAB CONTENT */}
            {activeTab === 'record' && (
              <div className="p-6 md:p-8 flex flex-col gap-6">
                {isNavigating ? (
                  <>
                    <div className="flex items-center justify-between mt-2">
                       <div>
                         <div className="flex items-center gap-2 mb-1.5">
                           <span className="text-[11px] font-bold text-green-400 tracking-widest uppercase py-0.5 px-2 bg-green-500/10 rounded-full border border-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)] flex items-center gap-1.5 shadow-inner">
                             <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div> Navigating
                           </span>
                         </div>
                         <h2 className="text-xl font-extrabold text-white tracking-tight leading-tight truncate w-48">{selectedRoute?.storeName}</h2>
                       </div>
                       
                       <button 
                          className="bg-red-500/10 text-red-500 border border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.2)] px-5 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-600 hover:text-white active:scale-95 transition-all outline-none" 
                          onClick={stopNav}
                        >
                          <Square className="w-5 h-5 fill-current" />
                          Stop
                        </button>
                    </div>

                    <div className="bg-slate-800/50 border border-slate-700/50 backdrop-blur-md rounded-2xl p-4 flex flex-col shadow-inner relative overflow-hidden mt-4">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/10 rounded-full blur-2xl"></div>
                      <span className="text-green-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 mb-1.5"><Navigation2 className="w-3 h-3"/> Follow Path</span>
                      <p className="text-sm text-slate-300 font-medium leading-relaxed">Turn-by-turn voice navigation is active. Drive carefully.</p>
                      
                      <div className="grid grid-cols-2 gap-3 mt-4">
                        <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-800">
                           <span className="text-amber-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1 mb-1"><Zap className="w-3 h-3"/> Speed</span>
                           <span className="text-lg font-bold text-white">{currentSpeedKph.toFixed(0)} <span className="text-xs text-slate-400">kph</span></span>
                        </div>
                        <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-800">
                           <span className="text-cyan-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1 mb-1"><MapPin className="w-3 h-3"/> Total Route</span>
                           <span className="text-lg font-bold text-white">{selectedRoute?.distanceKm.toFixed(2)} <span className="text-xs text-slate-400">km</span></span>
                        </div>
                      </div>
                    </div>
                  </>
                ) : !isRecording ? (
                  <>
                    <div className="text-center mt-2">
                      <div className="w-16 h-16 bg-gradient-to-br from-cyan-400/20 to-blue-600/20 text-cyan-400 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-[0_0_30px_rgba(6,182,212,0.2)] border border-cyan-500/30">
                        <MapPin className="w-8 h-8 drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
                      </div>
                      <h2 className="text-2xl font-extrabold text-white tracking-tight">Initiate Delivery</h2>
                      <p className="text-slate-400 text-sm mt-1.5 font-medium">Set destination & start sequence.</p>
                    </div>
                    
                    <div className="relative mt-2 group">
                      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                        <Navigation className="h-5 w-5 text-cyan-500 group-focus-within:text-cyan-400 rotate-45 transition-colors"/>
                      </div>
                      <input
                          type="text"
                          className="w-full bg-slate-800/50 border border-slate-700 focus:bg-slate-800 focus:border-cyan-500 rounded-2xl py-4 pl-12 pr-4 text-white font-bold placeholder:text-slate-500 placeholder:font-medium shadow-inner transition-all outline-none focus:ring-4 focus:ring-cyan-500/20"
                          placeholder="e.g. Sector 7, Road 14"
                          value={storeNameInput}
                          onChange={e => setStoreNameInput(e.target.value)}
                      />
                    </div>

                    <button 
                      className="w-full relative group overflow-hidden bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-[0_0_30px_rgba(6,182,212,0.3)] py-4 mt-2 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 hover:shadow-[0_0_40px_rgba(6,182,212,0.5)] active:scale-95 transition-all border border-cyan-400/50" 
                      onClick={startRecording}
                    >
                      <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
                      <Play className="w-5 h-5 fill-current relative z-10" />
                      <span className="relative z-10">Start Tracking</span>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between mt-2">
                       <div>
                         <div className="flex items-center gap-2 mb-1.5">
                           <div className="relative flex h-3 w-3">
                             <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                             <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600 shadow-[0_0_10px_rgba(239,68,68,0.8)]"></span>
                           </div>
                           <span className="text-[11px] font-bold text-red-500 tracking-widest uppercase py-0.5 px-2 bg-red-500/10 rounded-full border border-red-500/20">Live Sync</span>
                         </div>
                         <h2 className="text-xl font-extrabold text-white tracking-tight leading-tight truncate w-48">{storeNameInput}</h2>
                       </div>
                       
                       <button 
                          className="bg-red-500/10 text-red-500 border border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.2)] px-5 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-600 hover:text-white active:scale-95 transition-all outline-none" 
                          onClick={stopRecording}
                        >
                          <Square className="w-5 h-5 fill-current" />
                          Stop
                        </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mt-4">
                        <div className="bg-slate-800/50 border border-slate-700/50 backdrop-blur-md rounded-2xl p-3.5 flex flex-col shadow-inner">
                          <span className="text-cyan-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 mb-1.5"><MapPin className="w-3 h-3"/> Dist</span>
                          <span className="text-xl font-black text-white tracking-tight drop-shadow-md">{currentDistance.toFixed(2)} <span className="text-xs font-bold text-slate-400">km</span></span>
                        </div>
                        <div className="bg-slate-800/50 border border-slate-700/50 backdrop-blur-md rounded-2xl p-3.5 flex flex-col shadow-inner">
                          <span className="text-purple-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 mb-1.5"><Timer className="w-3 h-3"/> Time</span>
                          <span className="text-xl font-black text-white tracking-tight drop-shadow-md">{formatDuration(elapsedSeconds)}</span>
                        </div>
                        <div className="bg-slate-800/50 border border-slate-700/50 backdrop-blur-md rounded-2xl p-3.5 flex flex-col shadow-inner relative overflow-hidden">
                          <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/10 rounded-full blur-xl"></div>
                          <span className="text-amber-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 mb-1.5"><Zap className="w-3 h-3"/> Speed</span>
                          <span className="text-xl font-black text-white tracking-tight drop-shadow-md">{currentSpeedKph.toFixed(0)} <span className="text-xs font-bold text-slate-400">kph</span></span>
                        </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* HISTORY TAB CONTENT */}
            {activeTab === 'history' && (
              <div className="flex flex-col h-full overflow-hidden pb-4">
                <div className="p-6 md:p-8 pb-4 shrink-0 relative">
                  {/* Decorative ambient light */}
                  <div className="absolute top-0 right-10 w-32 h-32 bg-purple-600/20 rounded-full blur-3xl pointer-events-none"></div>
                  
                  <h2 className="text-2xl font-extrabold text-white tracking-tight mb-5 flex items-center gap-2">
                    <HistoryIcon className="text-purple-400 drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]" />
                    Datapad Archives
                  </h2>
                  <div className="relative group">
                    <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400 group-focus-within:text-purple-400 transition-colors" />
                    <input 
                        type="text" 
                        placeholder="Search locations..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-800/50 border border-slate-700 text-white placeholder-slate-500 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:bg-slate-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-500/20 transition-all font-semibold shadow-inner"
                      />
                  </div>
                </div>
                
                <div className="px-6 md:px-8 overflow-y-auto flex-1 custom-scrollbar">
                  {filteredRoutes.length === 0 ? (
                    <div className="text-center pt-8 pb-12 text-slate-500">
                      <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700/50">
                        <Map className="w-6 h-6 opacity-40 text-slate-300" />
                      </div>
                      <p className="font-semibold text-slate-400">No paths saved yet.</p>
                      <p className="text-sm mt-1">Start tracking to build history.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 pb-8">
                      <AnimatePresence>
                        {filteredRoutes.map(route => (
                          <motion.div 
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            key={route.id} 
                            onClick={() => handleSelectRoute(route)}
                            className={`p-4 rounded-2xl cursor-pointer border transition-all duration-300 group relative overflow-hidden
                              ${selectedRoute?.id === route.id 
                                ? 'bg-purple-900/40 border-purple-500/50 shadow-[0_0_20px_rgba(168,85,247,0.15)]' 
                                : 'bg-slate-800/30 border-slate-700/50 hover:bg-slate-800/60 hover:border-slate-600 hover:shadow-lg'}`}
                          >
                            {selectedRoute?.id === route.id && (
                               <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl pointer-events-none"></div>
                            )}

                            <div className="flex justify-between items-start mb-3 relative z-10">
                              <h3 className="font-bold text-white text-lg leading-tight flex-1 pr-4">{route.storeName}</h3>
                              <button 
                                onClick={(e) => deleteRoute(route.id, e)} 
                                className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
                              >
                                <Trash2 className="w-4 h-4"/>
                              </button>
                            </div>
                            <div className="flex flex-wrap items-center text-sm font-semibold text-slate-400 gap-3 relative z-10 mb-3">
                              <span className="flex items-center text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-1 rounded-lg"><MapPin className="w-3.5 h-3.5 mr-1"/> {route.distanceKm.toFixed(2)} km</span>
                              <span className="flex items-center text-purple-300"><Timer className="w-3.5 h-3.5 mr-1.5 opacity-60"/> {route.durationSec ? formatDuration(route.durationSec) : '--'}</span>
                              <span className="flex items-center text-slate-500"><Clock className="w-3.5 h-3.5 mr-1.5 opacity-60"/> {route.dateStr.split(',')[0]}</span>
                            </div>

                            {selectedRoute?.id === route.id && (
                               <button 
                                 onClick={(e) => { e.stopPropagation(); startNav(); }}
                                 className="w-full bg-purple-600 hover:bg-purple-500 text-white shadow-[0_4px_15px_rgba(168,85,247,0.4)] py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 z-20 relative border border-purple-400/30"
                               >
                                 <Navigation2 className="w-4.5 h-4.5" /> Start Navigation
                               </button>
                            )}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* FLOATING ACTION BUTTONS (Right Side) */}
      <div className="absolute right-4 bottom-8 md:bottom-8 md:right-8 z-[300] flex flex-col gap-3">
        <button
          onClick={() => setVoiceEnabled(!voiceEnabled)}
          className={`w-14 h-14 rounded-full shadow-[0_0_20px_rgba(0,0,0,0.5)] border backdrop-blur-md flex items-center justify-center transition-all duration-300
            ${voiceEnabled ? 'bg-indigo-600/90 text-white border-indigo-400/50 shadow-[0_0_20px_rgba(79,70,229,0.4)]' : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:bg-slate-700'}`}
          title={voiceEnabled ? 'Mute Voice' : 'Enable Voice'}
        >
          {voiceEnabled ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
        </button>

        {activeTab === 'history' && selectedRoute && (
           <motion.button
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              onClick={() => { setSelectedRoute(null); setFollowUser(true); }}
              className="w-14 h-14 rounded-full bg-slate-800/80 backdrop-blur-md text-slate-300 shadow-[0_0_20px_rgba(0,0,0,0.5)] border border-slate-700 flex items-center justify-center hover:bg-slate-700 hover:text-white transition-all font-bold group"
              title="Clear Selection"
           >
              <X className="w-6 h-6 group-hover:scale-110 transition-transform" />
           </motion.button>
        )}
        
        <button
          onClick={() => setFollowUser(!followUser)}
          className={`w-14 h-14 rounded-full shadow-[0_0_20px_rgba(0,0,0,0.5)] border backdrop-blur-md flex items-center justify-center transition-all duration-300
            ${followUser ? 'bg-cyan-600/90 text-white border-cyan-400/50 shadow-[0_0_20px_rgba(6,182,212,0.4)]' : 'bg-slate-800/80 text-cyan-400 border-slate-700 hover:bg-slate-700'}`}
          title="Center on Me"
        >
          <Crosshair className="w-6 h-6" />
        </button>
      </div>

    </div>
  );
}

