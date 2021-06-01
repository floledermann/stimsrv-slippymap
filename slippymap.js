
const parameterController = require("stimsrv/controller/parameterController");
const valOrFunc = require("stimsrv/util/valOrFunc");

const resource = require("stimsrv/util/resource");

let pick = require("stimsrv/util/pickProperties");

// I don't see an easy way to get those programmatically, so extracted all map options from Leaflet docs
const leafletMapOptions = [
  "attributionControl","zoomControl","closePopupOnClick","zoomSnap","zoomDelta",
  "boxZoom","doubleClickZoom","dragging","crs","minZoom","maxZoom","maxBounds",
  "zoomAnimation","zoomAnimationThreshold","fadeAnimation","markerZoomAnimation",
  "inertia","inertiaDeceleration","inertiaMaxSpeed","easeLinearity","maxBoundsViscosity",
  "keyboard","keyboardPanDelta","scrollWheelZoom","wheelDebounceTime","wheelPxPerZoomLevel",
  "tap","tapTolerance","touchZoom","bounceAtZoomLimits"
]

let slippyMapRenderer = function(config) {
  
  config = Object.assign({
    synchronize: false,
    synchronizeView: "centerZoom", // "bounds"
    interaction: true
  }, config);
  
  // Leaflet reference
  let L = null;
  let map = null;
  
  let sync = {ongoing: false};
  let duringUserMovement = false;
  
  return {
    initialize: function(parent, stimsrv, context) {
      
      if (!L) L = require("leaflet");
      
      parent.innerHTML = `<link rel="stylesheet" href="${resource.url("slippymap")}/leaflet.css"/>  `;
      
      let document = parent.ownerDocument;
      
      let mapEl = document.createElement("div");
      mapEl.className = "slippymap";
      mapEl.id = "slippymap";
      mapEl.style.width = "100%";
      mapEl.style.height = "100%";
      parent.appendChild(mapEl);
      
      let mapOptions = pick(config, leafletMapOptions);
      if (config.interaction === false) {
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
            
      let zoom = valOrFunc(config.initialZoom, context);
      if (zoom && typeof zoom == "number") {
        map.setZoom(config.initialZoom);
      }
      
      // Leaflet is sensitive to order of zoom/pan commands
      // to test see http://jsfiddle.net/sx5gtwa7/3/
      let initialPosition = valOrFunc(config.initialPosition, context);
      if (initialPosition && Array.isArray(initialPosition)) {
        map.setView(config.initialPosition);
      }
      
      if (config.synchronize) {
        
        function sendMapSyncEvent() {
          let data = null;
          if (config.synchronizeView == "bounds") {
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
          
          stimsrv.event("mapmove", data);
        }
        
        const debugui = false;
        
        // Leaflet events fire liberally also during programmatically triggered changes
        // not sure how to best detect real user interaction
        let lastUpdateTime = 0;
        // this does not work on the map, use DOM element instead
        mapEl.addEventListener("touchstart", function(event) {
          if (debugui) console.log("TOUCHSTART");
          duringUserMovement = true;
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
          if (!sync.ongoing) {
            sendMapSyncEvent();
          }
        });
        map.on("mouseup", function(event) {
          if (debugui) console.log("MOUSEUP");
          duringUserMovement = false;
        });

      }
      
    },
    render: function(condition) {
      
      if (condition.initialPosition) {
        map.setView(condition.initialPosition, condition.initialZoom); 
      }
      else if (condition.initialZoom) {
        map.setZoom(condition.initialZoom);
      }
      
      console.log("Centering map on " + condition.initialPosition);
    },
    event: function(type, data) {
      if (config.synchronize && type == "mapmove") {
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
    },
    getMap: () => map,
    resources: resource("slippymap", "resources", __dirname)
  }
}


const DEFAULTS = {
  tiles: null, // tiles must be specified by experiment
  minZoom: 0,
  maxZoom: 20,
  initialPosition: [0,0],
  initialZoom: 6,
}

function slippyMapTask(config) {
  
  config = Object.assign({}, DEFAULTS, config);
  // do we want to use separate parameters object?
  //config.parameters = Object.assign({}, DEFAULTS.parameters, config.parameters);
  
  if (!(config.tiles?.tileURL)) {
    console.error("Slippymap task: config.tiles.tileURL must be specified!");
  }

  let renderer = slippyMapRenderer(config);
  
  return {
    name: "slippymap",
    description: "Interactive (slippy) map",
    ui: function(context) {
      return {
        interfaces: {
          display: renderer,
          response: null,
          monitor: renderer,
          control: null,
        },
        event: function(type, data) {
          renderer.event(type, data);
        },
      }
    },
    controller: parameterController({parameters: config}),
    resources: renderer.resources
  }
}

slippyMapTask.renderer = slippyMapRenderer;

module.exports = slippyMapTask;