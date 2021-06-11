
const nextOnResponse = require("stimsrv/controller/nextOnResponse");
const valOrFunc = require("stimsrv/util/valOrFunc");

const resource = require("stimsrv/util/resource");

let pick = require("stimsrv/util/pickProperties");

const DEFAULTS = {
  name: "slippymap",          // task name
  description: "Interactive (slippy) map",
  tiles: null,                // tiles must be specified by experiment!
  initialPosition: [0,0],     // array or f(context)
  initialZoom: 6,             // number or f(context)
  initialBounds: null,        // if defined, takes precedence over initialPosition and initialZoom, array or f(context)
  initialBoundsOptions: {animate: false}, // object or f(context)
  minZoom: 0,                 // number or f(context)
  maxZoom: 20,                // number or f(context)
  interaction: true,          // bool or f(context)
  synchronize: false,         // bool or f(context)
  synchronizeMode: "centerZoom", // "centerZoom" or "bounds"
  synchronizeEventType: "mapmove",
  mapInterfaces: ["display","monitor"], // interfaces to show the map on, array or f(context)
  auxInterfaces: {},                    // further interfaces to show, object or f(context)
  leafletOptions: {}, // options passed to leaflet, object or f(context)
  // callback functions
  // each of those will be called with "map" and "context" as additional parameters
  // after internal handling (setup of map, map synchronization)
  initialize: null, // (parent, stimsrv, map, context) => {...}
  render: null,     // (condition, map, context) => {...}
  event: null,      // (type, data, map, context) => {...}
  controller: nextOnResponse(),
}

const taskContextKeys = ["mapInterfaces","auxInterfaces"];
const rendererContextKeys = ["tiles","initialZoom","initialPosition","initialBounds","initialBoundsOptions","minZoom","maxZoom","interaction","synchronize","leafletOptions"];


// I don't see an easy way to get those programmatically, so extracted all map options from Leaflet docs
const leafletMapOptions = [
  "attributionControl","zoomControl","closePopupOnClick","zoomSnap","zoomDelta",
  "boxZoom","doubleClickZoom","dragging","crs","minZoom","maxZoom","maxBounds",
  "zoomAnimation","zoomAnimationThreshold","fadeAnimation","markerZoomAnimation",
  "inertia","inertiaDeceleration","inertiaMaxSpeed","easeLinearity","maxBoundsViscosity",
  "keyboard","keyboardPanDelta","scrollWheelZoom","wheelDebounceTime","wheelPxPerZoomLevel",
  "tap","tapTolerance","touchZoom","bounceAtZoomLimits"
];

let resources = resource("slippymap", "resources", __dirname);

let slippyMapRenderer = function(config, context) {
  
  config = valOrFunc.properties(Object.assign({}, DEFAULTS, config), rendererContextKeys, context);
  
  if (!(config.tiles?.tileURL)) {
    throw new Error("Slippymap renderer: config.tiles.tileURL must be specified!");
  }
  
  // Leaflet reference
  let L = null;
  let map = null;
  
  let sync = {ongoing: false};
  let duringUserMovement = false;
  
  return {
    initialize: function(parent, stimsrv) {
      
      if (!L) L = require("leaflet");
      
      parent.innerHTML = `<link rel="stylesheet" href="${resource.url("slippymap")}/leaflet.css"/>  `;
      
      let document = parent.ownerDocument;
      
      let mapEl = document.createElement("div");
      mapEl.className = "slippymap";
      mapEl.id = "slippymap";
      mapEl.style.width = "100%";
      mapEl.style.height = "100%";
      parent.appendChild(mapEl);
      
      let mapOptions = Object.assign({}, config.leafletOptions); //pick(config, leafletMapOptions);
      if (!config.interaction) {
        Object.assign(mapOptions, {
          boxZoom: false,
          doubleClickZoom: false,
          dragging: false,
          zoomControl: false,
          scrollWheelZoom: false,
          touchZoom: false,
          keyboard: false
        });
      }
      
      map = L.map('slippymap', mapOptions);
      L.tileLayer(config.tiles.tileURL, config.tiles).addTo(map);
      
      map.attributionControl.setPrefix("");
            
      if (config.initialBounds) {
        map.fitBounds(config.initialBounds, config.initialBoundsOptions);
      }
      else {
        // Leaflet is sensitive to order of zoom/pan commands
        // to test see http://jsfiddle.net/sx5gtwa7/3/
        if (config.initialZoom && typeof config.initialZoom == "number") {
          map.setZoom(config.initialZoom);
        }
        
        if (config.initialPosition && Array.isArray(config.initialPosition)) {
          map.setView(config.initialPosition);
        }
      }
      
      if (config.synchronize) {
        
        function sendMapSyncEvent() {
          let data = null;
          if (config.synchronizeMode == "bounds") {
            let bounds = map.getBounds();
            data = {
              bounds: [[bounds.getNorth(), bounds.getEast()],[bounds.getSouth(), bounds.getWest()]]
            };
          }
          else {
            let pos = map.getCenter();
            data = {
              center: {lat: pos.lat, lng: pos.lng},
              zoom: map.getZoom()
            };
          }
          
          stimsrv.event(config.synchronizeEventType, data);
        }
        
        const debugui = false;
        
        let duringWheel = false;
                
        // Leaflet events fire liberally also during programmatically triggered changes
        // not sure how to best detect real user interaction
        let lastUpdateTime = 0;
        // this does not work on the map, use DOM element instead
        mapEl.addEventListener("touchstart", function(event) {
          if (debugui) console.log("TOUCHSTART");
          duringUserMovement = true;
        });
        mapEl.addEventListener("wheel", function(event) {
          if (debugui) console.log("TOUCHSTART");
          duringUserMovement = true;
          duringWheel = true;
        });
        map.on("mousedown", function(event) {
          if (debugui) console.log("MOUSEDOWN");
          duringUserMovement = true;
        });
        map.on("movestart", function(event) {
          if (debugui) console.log("MOVESTART");
        });
        map.on("move", function(event) {
          if (debugui) console.log("MOVE");
          if (duringUserMovement && !sync.ongoing && Date.now() - lastUpdateTime > 100) {
            sendMapSyncEvent();
            lastUpdateTime = Date.now();
          }
        });
        map.on("moveend", function(event) {
          if (debugui) console.log("MOVEEND");
          if (duringUserMovement && !sync.ongoing) {
            sendMapSyncEvent();
          }
        });
        map.on("zoomend", function(event) {
          if (debugui) console.log("ZOOMEND");
          if (duringUserMovement && !sync.ongoing) {
            sendMapSyncEvent();
          }
          if (duringWheel) {
            // wait until after listeners have been completed
            setTimeout(() => {
              duringWheel = false;
              duringUserMovement = false;
            }, 1);
          }
        });
        map.on("mouseup", function(event) {
          if (debugui) console.log("MOUSEUP");
          duringUserMovement = false;
        });
        
        map.addUserEventListener = function(type, callback) {
          map.addEventListener(type, function(event) {
            if (duringUserMovement && !sync.ongoing) {
              callback(event);
            }
          });
        }

      }
      
      if (config.initialize) config.initialize(parent, stimsrv, map, context);
      
    },
    render: function(condition) {
      
      if (config.render) {
        config.render(condition, map, context);
      }
      else {
        if (condition.mapPosition) {
          map.setView(condition.mapCenter, condition.mapZoom); 
        }
        else if (condition.mapZoom) {
          map.setZoom(condition.mapZoom);
        }
      }
      //console.log("Centering map on " + condition.initialPosition);
    },
    event: function(type, data) {
      if (config.synchronize && type == config.synchronizeEventType) {
        if (!duringUserMovement) {
          // store local copy in closure, to ensure that only last event can reset globally
          sync = {ongoing: true};
          let _sync = sync;
          if (data.bounds) {
            map.on("moveend", () => { _sync.ongoing = false; });
            map.fitBounds(data.bounds); //, {animate: false});
          }
          if (data.center && data.zoom) {
            map.on("moveend", () => { _sync.ongoing = false; });
            map.setView(data.center, data.zoom); //, {animate: false});
          }
        }
      }
      
      if (config.event) config.event(type, data, map, context);
    },
    getMap: () => map,
    resources: resources
  }
}


function slippyMapTask(config) {
  
  config = Object.assign({}, DEFAULTS, config);

  return {
    name: config.name,
    description: config.description,
    ui: function(context) {
      
      config = valOrFunc.properties(config, taskContextKeys, context);
      
      let renderer = slippyMapRenderer(config, context);
      
      let uis = valOrFunc(config.auxInterfaces, context);
      for (let ui of valOrFunc(config.mapInterfaces, context)) {
        uis[ui] = renderer;
      }
      return {
        interfaces: uis
      };
    },
    controller: config.controller,
    resources: resources
  }
}

slippyMapTask.renderer = slippyMapRenderer;

module.exports = slippyMapTask;