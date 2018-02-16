/*
 * Copyright (c) 2018 Bert Freudenberg
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

const $ = _ => document.getElementById(_);
const byClass = (_, cls) => Array.from(_.getElementsByClassName(cls));

let storage = {}; try {storage = localStorage} catch(e) {}; // for testing in private window

let refreshMap = null;

const {gyms, city, cells} = getGyms();

const storageKeyV0 = 'gym-levels';
const storageKeyV1 = city + ':gym-levels';
const storageKeyV2 = city + ':gym-levels-v2';

const storageKey = storageKeyV2;
const storageKeyOld = storageKey + '-old';

(function start() {
    updateSums();
    if (location.search) {
        $('content').style.display = 'none';
        $('restore').style.display = 'inline';
        return;
    }
    if (location.hash === '#undo' && getOldLevelsString()) {
        $('undo').style.display = 'inline';
    }
    makeList();
    updateShare();
    switch (location.hash) {
        case '#map': showAsMap(); break; 
        case '#district': showByDistrict(); break; 
        case '#level': showByLevel(); break; 
        case '#exraid': showByExraid(); break; 
        default: showByName();
    }
})();

function keyToToken(key) {
    // this function is missing from S2 JavaScript lib
    // because it uses HilbertQuadkeys instead of 64 bit integers
    const [face, quads] = (key+'20').split('/');    // need to append 1 bit, not quite sure why
    // we start with 3 bits for the face
    let bits = +face;
    let n = 3;
    let token = '';
    // assemble token one hex digit at a time
    for (let i = 0; i < quads.length; i++) {
      bits = bits << 2 | quads[i];          // next 2 bits
      n += 2;
      if (n >= 4) {
        const digit = bits >> (n-4);        // upper 4 bits
        token += digit.toString(16);
        bits = bits & ~(digit << (n-4));    // clear out
        n -= 4;
      }
    }
    return token.replace(/0+$/, '');        // trim trailing zeroes
}

function cellName(cell) {
    const token = cell.toHilbertQuadkey ? keyToToken(cell.toHilbertQuadkey()) : cell;
    return cells && cells[token] || token;
}

// add divs for each gym
function makeList() {
    for (const gym of gyms) {
        gym.div = document.createElement('div');
        gym.div.className = gym.exraid ? 'item exraid' : 'item';
        gym.div.innerHTML = `
            <img src="gym${gym.levelEx}.png" class="badge" width="36" height="48">
            <div><b>${gym.name}</b><br>
                ${gym.district ? gym.district+',' : ''}
                <a href="https://www.google.com/maps/?q=${gym.location}">${gym.address || 'map'}</a>
                ${gym.park ? '<br>' : ''}
                ${typeof gym.park == 'string' ? '[<a href="http://www.openstreetmap.org/' + gym.park + '">EX</a>]' : ''}
                ${gym.park ? cellName(gym.cell) : ''}
            </div>${gym.exraid ? '<a href="md-exraids.html"><img src="exraid.png" class="exbadge"></a>' : ''}`;
        const badge = byClass(gym.div, 'badge')[0];
        badge.onclick = () => {
            incLevel(gym.id);
            badge.src = `gym${gym.levelEx}.png`;
            if (gym.setMarker) gym.setMarker(gym.levelEx);   // update map marker
        };
    }
}

// leaflet.js map
function makeMap() {

    // center map on user's gyms
    function weightedCenter(weights = [0.0001, 0.001, 1, 2, 4]) {
        let center = [0, 0],
            count = 0;
        for (const gym of gyms) {
            const weight = weights[gym.level];
            center[0] += weight * gym.location[0];
            center[1] += weight * gym.location[1];
            count += weight;
        }
        return center.map(sum => sum / count);
    }

    const bounds = L.latLngBounds(gyms.map(gym => gym.location)).pad(0.3);
    const map = L.map('map', {
        center: weightedCenter(),
        zoom: 14,
        maxBounds: bounds,
        fullscreenControl: true,
    });
    // Please get your own token at https://www.mapbox.com/signup/ It's free.
    const mapboxToken = '';
    // For testing only, you could use the OSM tile server instead:
    // L.tileLayer('http://{s}.tile.osm.org/{z}/{x}/{y}.png', {
    L.tileLayer(`https://api.tiles.mapbox.com/v4/mapbox.pirates/{z}/{x}/{y}.png?access_token=${mapboxToken}`, {
        attribution: '© <a href="http://openstreetmap.org">OpenStreetMap</a> | © <a href="http://mapbox.com">Mapbox</a>',
        minZoom: 12,
        maxZoom: 17,
    }).addTo(map);

    // add gym markers
    // level 0-4 are regular gyms, 5-9 exraid gyms
    const icons = [0,1,2,3,4,5,6,7,8,9].map(level => L.icon({
        iconUrl: `gym${level}.png`,
        iconSize: [36, 48],
        iconAnchor: [18, 42],
        popupAnchor: [18, 6],
        shadowUrl: 'gym_.png',
        shadowSize: [36, 48],
        shadowAnchor: [18, 35],
    }));
    for (const gym of gyms) {
        const loc = L.latLng(gym.location);
        const marker = L.marker(loc, {icon: icons[gym.levelEx], riseOnHover: true});
        marker.bindTooltip(`${gym.name}${gym.park ? ' [EX] ' + cellName(gym.cell) : ''}`);
        //if (gym.park) marker.bindPopup(cellName(gym.cell) + ': ' + gym.cell);
        marker.addTo(map);
        gym.setMarker = lv => marker.setIcon(icons[lv]);    // used in makeList()
    }

    // Show S2 cells  
    function showS2Cells(level, style, showNames) {
        // we just make a grid around the center cell
        // count is a guess based on S2 cell size ... better use a S2RegionCoverer
        const size = L.CRS.Earth.distance(bounds.getSouthWest(), bounds.getNorthEast()) / 10000 + 1|0;
        const count = 2 ** level * size >> 10;

        function addPoly(cell) {
            const shape = showNames ? "polygon" : "polyline";
            const vertices = cell.getCornerLatLngs();
            if (shape === "polyline") vertices.push(vertices[0]);
            const poly = L[shape](vertices,
                Object.assign({color: 'blue', opacity: 0.3, weight: 2, fillOpacity: 0.0}, style));
            if (showNames && cells) poly.bindTooltip(cellName(cell));
            poly.addTo(map);
        }

        // add cells spiraling outward
        let cell = S2.S2Cell.FromLatLng(bounds.getCenter(), level);
        let steps = 1;
        let direction = 0;
        do {
            for (let i = 0; i < 2; i++) { 
                for (let i = 0; i < steps; i++) {
                    addPoly(cell);
                    cell = cell.getNeighbors()[direction % 4];
                }
                direction++;
            }
            steps++;
        } while (steps < count);
    }

    showS2Cells(13, {color: '#999'});
    showS2Cells(12, {color: 'blue'}, true);
    // showS2Cells(11, {color: 'green', weight: 3});
    showS2Cells(10, {color: 'red'});
    // showS2Cells( 9, {color: 'yellow', weight: 16});
   
    // used in showAsMap()
    refreshMap = _ => L.Util.requestAnimFrame(map.invalidateSize, map, !1, map._container);
}

// add <a> jump targets and nav bar
function makeJumpTable(nameFn = _ => _.name) {
    const targets = [];
    let target = '';
    for (const gym of gyms) {
        const name = nameFn(gym);
        const initial = name[0].toUpperCase();
        if (target !== initial && initial.match(/[A-Z0-9]/i)) {
            target = initial;
            const a = document.createElement('a');
            a.id = target;
            a.className = 'jumptarget';
            gym.div.insertBefore(a, gym.div.childNodes[0]);
            if (initial.match(/[A-Z]/i)) targets.push(target);
        }
    }
    $('jump').innerHTML = targets.map(t => `<a href="#${t}">&nbsp;${t}&nbsp;</a>`).join(' ');
}

function deleteListItems() {
    const list = $('list');
    while (list.firstChild)
        list.removeChild(list.firstChild);
}

function updateSums() {
    const n = [0, 0, 0, 0, 0];
    for (const gym of gyms)
        n[gym.level]++;
    const sums = [n[0] + n[1], n[2], n[3], n[4]];
    for (let i = 0; i < 4; i++)
        $(`sum${i}`).innerText = sums[i];
    $(`sum`).innerText = gyms.length;
}

//////////////// View Switching ////////////////

function show(ids) {
    for (const id of ['list', 'jump', 'map'])
        $(id).style.display = ids.includes(id) ? 'block' : 'none';
}

function showList(sortFn, jumpFn, filterFn = _ => true) {
    deleteListItems();
    gyms.sort(sortFn);     // for jump table
    gyms.filter(filterFn).forEach(gym => $('list').appendChild(gym.div));
    if (jumpFn) makeJumpTable(jumpFn);
    show(jumpFn ? ['list','jump'] : ['list']);
}

function showByName() {
    showList(compareNames, gym => gym.name);
    history.replaceState(null, "By Name", "#name");
}

function showByDistrict() {
    showList(compareDistricts, gym => gym.district);
    history.replaceState(null, "By District", "#district");
}

function showByLevel(level) {
    showList(compareLevels, gym => '' + gym.level);
    if (level !== undefined) location.hash = "#" + level;
    else history.replaceState(null, "By Level", "#level");
}

function showByExraid() {
    showList(compareCells, null, gym => gym.exraid || gym.park);
    history.replaceState(null, "By Exraid", "#exraid");
}

function showAsMap() {
    const mapContent = $('map').children.length;
    if (!mapContent) makeMap();
    show(['map']);
    refreshMap();
    history.replaceState(null, "Map", "#map");
}


//////////////// Sharing ////////////////

function reload(suffix) {
    location.href = thisURL(suffix);
}

function thisURL(suffix) {
    const {protocol, host, pathname} = document.location;
    return protocol + '//' + host + pathname + (suffix ? suffix : '');
}

function updateShare() {
    $('share-url').href = thisURL('?' + getLevelsString());
}

function doRestore() {
    const undo = getLevelsString();
    setLevelsString(location.search.substr(1));
    if (undo) {
        setOldLevelsString(undo);
        reload('#undo');
    } else {
        reload();
    }
}

function undoRestore() {
    const redo = getLevelsString();
    setLevelsString(getOldLevelsString());
    setOldLevelsString(redo);
    reload();
}

//////////////// Sorting ////////////////

function compareNames(a, b) {
    return a.name.localeCompare(b.name);
}

function compareAddress(a, b) {
    const [, streetA, nrA] = a.address.match(/^([^0-9]*)(.*)$/);
    const [, streetB, nrB] = b.address.match(/^([^0-9]*)(.*)$/);
    const result = streetA.localeCompare(streetB);
    if (result) return result;
    return parseInt(nrA) - parseInt(nrB);
}

function compareDistricts(a, b) {
    let result = a.district.localeCompare(b.district);
    if (result) return result;
    result = b.level - a.level;
    if (result) return result;
    return compareAddress(a, b);
}

function compareLevels(a, b) {
    const result = b.level - a.level;
    if (result) return result;
    return compareDistricts(a, b);
}

function compareCells(a, b) {
    if (a.cell === b.cell) return compareLevels(a, b);
    const [, na, sa] = cellName(a.cell).match(/([0-9]+)(.*)$/);
    const [, nb, sb] = cellName(b.cell).match(/([0-9]+)(.*)$/);
    if (na !== nb) return parseInt(na) - parseInt(nb);
    return sa.localeCompare(sb);
}

//////////////// Badge Storage ////////////////

function sanitizeV0(s) { return String(s).replace(/[^0-3]/g, '0'); }
function sanitizeV1(s) { return String(s).replace(/[^0-3]/g, '0'); }
function sanitizeV2(s) { return String(s).replace(/[^0-4]/g, '0'); }

function convertV0ToV1(s) { return s; }
function convertV1ToV2(s) { return s.replace(/3/g, '4').replace(/2/g, '3').replace(/1/g, '2'); }

function getLevelsV0() { return sanitizeV0(storage[storageKeyV0] || ''); }
function getLevelsV1() { return sanitizeV1(storage[storageKeyV1] || convertV0ToV1(getLevelsV0())); }
function getLevelsV2() { return sanitizeV2(storage[storageKeyV2] || convertV1ToV2(getLevelsV1())); }

function sanitize(s) { return sanitizeV2(s); }
function getLevelsString() { return getLevelsV2(); }
function setLevelsString(s) { storage[storageKey] = sanitize(s); updateShare(); }

function getOldLevelsString() { return sanitize(storage[storageKeyOld] || ''); }
function setOldLevelsString(s) { storage[storageKeyOld] = sanitize(s); }

function setLevel(i, level) {
    let s = getLevelsString();
    while (s.length <= i) s += '0';
    setLevelsString(s.substr(0, i) + level + s.substr(i + 1));
}
function getLevel(i) { return getLevelsString()[i] | 0; }
function incLevel(i) {
    const level = (getLevel(i) + 1) % 5;
    setLevel(i, level);
    updateSums();
    return level;
}

//////////////// Gym Data ////////////////

// Add id to raw gym data and filter deleted gyms
// also add level accessor
function getGyms() {
    const {city, gyms, cells} = gymData();
    return {
        city: city,
        cells: cells,
        gyms: gyms.map((gym, index) => Object.assign({
                id: index,          // gym's index in storage string
                cell: keyToToken(S2.latLngToKey(gym.location[0], gym.location[1], 13)),
                get level() { return getLevel(index) },
                get levelEx() { return getLevel(index) + ((gym.exraid || gym.park) ? 5 : 0)},
            }, gym))
            .filter(({deleted}) => !deleted),
    };
}
