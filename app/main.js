/*  ============================================================
 *  Assign Equipment — Zoho CRM Blueprint Transition Widget
 *  ============================================================
 *  Creates Deals_X_Assets junction records for each selected
 *  asset whose date range does not overlap the Deal's requested
 *  window (booking OR blocked dates).
 *  ============================================================ */

// ──────────────────────────────────────────────────────────────
//  CONFIGURABLE FIELD API NAMES
//  Change these constants if your Zoho CRM field API names
//  differ from the defaults below.
// ──────────────────────────────────────────────────────────────

/** Deal module fields */
const DEAL_START_DATE_FIELD  = "Requested_Start_Date";
const DEAL_END_DATE_FIELD    = "Requested_End_Date";

/** Deals_X_Assets junction fields */
const DXA_RELATED_DEAL       = "Related_Deals";
const DXA_ASSIGNED_EQUIPMENT = "Assigned_Equipment";
const DXA_BOOKING_START      = "Booking_Start_Date";
const DXA_BOOKING_END        = "Booking_End_Date";
const DXA_BLOCKED_START      = "Blocked_Start_Date";
const DXA_BLOCKED_END        = "Blocked_End_Date";

/** Module API names */
const MODULE_DEALS           = "Deals";
const MODULE_ASSETS          = "Assets";
const MODULE_DXA             = "Deals_X_Assets";

/** Page size used when paginating getAllRecords */
const PAGE_SIZE = 200;

// ──────────────────────────────────────────────────────────────
//  DOM REFERENCES
// ──────────────────────────────────────────────────────────────
const $dealSummary   = document.getElementById("deal-summary");
const $dealName      = document.getElementById("deal-name");
const $dealStart     = document.getElementById("deal-start");
const $dealEnd       = document.getElementById("deal-end");
const $toolbar       = document.getElementById("toolbar");
const $searchInput   = document.getElementById("search-input");
const $selectedCount = document.getElementById("selected-count");
const $assignBtn     = document.getElementById("assign-btn");
const $selectAll     = document.getElementById("select-all");
const $tableContainer = document.getElementById("table-container");
const $tbody         = document.getElementById("assets-tbody");
const $loading       = document.getElementById("loading-state");
const $empty         = document.getElementById("empty-state");
const $error         = document.getElementById("error-state");
const $errorText     = document.getElementById("error-text");
const $resultBanner  = document.getElementById("result-banner");

// ──────────────────────────────────────────────────────────────
//  STATE
// ──────────────────────────────────────────────────────────────
let dealId          = null;
let dealRecord      = null;
let requestedStart  = null;   // Date object
let requestedEnd    = null;   // Date object
let availableAssets = [];     // assets shown in the table
let selectedIds     = new Set();
let isSaving        = false;

// ──────────────────────────────────────────────────────────────
//  INIT
// ──────────────────────────────────────────────────────────────

ZOHO.embeddedApp.on("PageLoad", function (data) {
  console.log("[Widget] PageLoad data:", data);
  /*  data.EntityId contains the Deal ID in a transition widget  */
  dealId = data && (data.EntityId || (data.EntityId && data.EntityId[0]));

  if (Array.isArray(dealId)) {
    dealId = dealId[0];
  }

  if (!dealId) {
    showError("Could not determine the current Deal. Please reload the widget.");
    return;
  }

  initWidget();
});

ZOHO.embeddedApp.init();

// ──────────────────────────────────────────────────────────────
//  CORE FLOW
// ──────────────────────────────────────────────────────────────

async function initWidget() {
  try {
    showLoading(true);

    // 1. Load Deal details
    dealRecord = await loadDealDetails(dealId);
    console.log("[Widget] Deal record:", dealRecord);

    requestedStart = parseDate(dealRecord[DEAL_START_DATE_FIELD]);
    requestedEnd   = parseDate(dealRecord[DEAL_END_DATE_FIELD]);

    if (!requestedStart || !requestedEnd) {
      showError(
        "The Deal is missing its requested start or end date (" +
        DEAL_START_DATE_FIELD + " / " + DEAL_END_DATE_FIELD + ")."
      );
      return;
    }

    renderDealSummary();

    // 2. Fetch all Assets and all existing Deals_X_Assets
    const [allAssets, allDXA] = await Promise.all([
      fetchAllRecords(MODULE_ASSETS),
      fetchAllRecords(MODULE_DXA)
    ]);

    console.log("[Widget] Total assets fetched:", allAssets.length);
    console.log("[Widget] Total Deals_X_Assets fetched:", allDXA.length);

    if (allAssets.length === 0) {
      showLoading(false);
      showEmpty("No assets found in the Assets module.");
      return;
    }

    // 3. Group assignments by Asset ID
    const assignmentsByAsset = groupAssignmentsByAsset(allDXA);

    // 4. Filter to only available assets
    availableAssets = filterAvailableAssets(allAssets, assignmentsByAsset);

    console.log("[Widget] Available assets:", availableAssets.length);

    showLoading(false);

    if (availableAssets.length === 0) {
      showEmpty("All assets are booked or blocked for the requested date range.");
      return;
    }

    // 5. Render
    renderAssetsTable(availableAssets);
    show($toolbar);
    show($tableContainer);
    bindEvents();

  } catch (err) {
    console.error("[Widget] initWidget error:", err);
    showError("Failed to load widget data. " + (err.message || ""));
  }
}

// ──────────────────────────────────────────────────────────────
//  DATA FETCHING
// ──────────────────────────────────────────────────────────────

/** Fetch a single Deal by ID */
async function loadDealDetails(id) {
  const resp = await ZOHO.CRM.API.getRecord({
    Entity: MODULE_DEALS,
    RecordID: id
  });
  console.log("[Widget] getRecord response:", resp);

  if (resp && resp.data && resp.data.length > 0) {
    return resp.data[0];
  }
  throw new Error("Deal record not found for ID " + id);
}

/**
 * Paginated fetch — keeps requesting pages until all records
 * are returned.  Works around the 200-record default limit.
 */
async function fetchAllRecords(module) {
  let page = 1;
  let allRecords = [];
  let hasMore = true;

  while (hasMore) {
    console.log("[Widget] Fetching " + module + " page " + page);

    const resp = await ZOHO.CRM.API.getAllRecords({
      Entity: module,
      page: page,
      per_page: PAGE_SIZE
    });

    if (resp && resp.data && resp.data.length > 0) {
      allRecords = allRecords.concat(resp.data);
      // If we got a full page there may be more
      hasMore = resp.data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }

  return allRecords;
}

// ──────────────────────────────────────────────────────────────
//  AVAILABILITY LOGIC
// ──────────────────────────────────────────────────────────────

/**
 * Build a map:  assetId -> [ assignmentRecord, ... ]
 */
function groupAssignmentsByAsset(dxaRecords) {
  const map = {};
  dxaRecords.forEach(function (rec) {
    // Lookup fields are stored as objects { id, name }
    const equipField = rec[DXA_ASSIGNED_EQUIPMENT];
    const assetId = equipField && (equipField.id || equipField);
    if (!assetId) return;
    if (!map[assetId]) map[assetId] = [];
    map[assetId].push(rec);
  });
  return map;
}

/**
 * Two date ranges overlap when:
 *   rangeAStart <= rangeBEnd  AND  rangeAEnd >= rangeBStart
 */
function isDateRangeOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && aEnd >= bStart;
}

/**
 * Returns true when the asset has NO overlapping booking or
 * blocked range with the Deal's requested window.
 */
function isAssetAvailableForRange(assignments, reqStart, reqEnd) {
  for (var i = 0; i < assignments.length; i++) {
    var rec = assignments[i];

    // Check booking range overlap
    var bStart = parseDate(rec[DXA_BOOKING_START]);
    var bEnd   = parseDate(rec[DXA_BOOKING_END]);
    if (isDateRangeOverlap(reqStart, reqEnd, bStart, bEnd)) {
      return false;
    }

    // Check blocked / buffer range overlap
    var blStart = parseDate(rec[DXA_BLOCKED_START]);
    var blEnd   = parseDate(rec[DXA_BLOCKED_END]);
    if (isDateRangeOverlap(reqStart, reqEnd, blStart, blEnd)) {
      return false;
    }
  }
  return true;
}

/**
 * Return only assets that are available for the requested range.
 */
function filterAvailableAssets(allAssets, assignmentsByAsset) {
  return allAssets.filter(function (asset) {
    var assetId = asset.id;
    var assignments = assignmentsByAsset[assetId] || [];
    return isAssetAvailableForRange(assignments, requestedStart, requestedEnd);
  });
}

// ──────────────────────────────────────────────────────────────
//  RENDERING
// ──────────────────────────────────────────────────────────────

function renderDealSummary() {
  $dealName.textContent = dealRecord.Deal_Name || dealRecord.Name || "Deal";
  $dealStart.textContent = formatDate(requestedStart);
  $dealEnd.textContent   = formatDate(requestedEnd);
  show($dealSummary);
}

/**
 * Render the table body with available assets.
 * Accepts the array so it can be called again after filtering.
 */
function renderAssetsTable(assets) {
  $tbody.innerHTML = "";

  assets.forEach(function (asset) {
    var tr = document.createElement("tr");
    tr.setAttribute("data-id", asset.id);

    if (selectedIds.has(asset.id)) {
      tr.classList.add("selected");
    }

    // Checkbox cell
    var tdCheck = document.createElement("td");
    tdCheck.className = "col-check";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selectedIds.has(asset.id);
    cb.addEventListener("change", function () {
      toggleSelection(asset.id, cb.checked, tr);
    });
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    // Asset Name
    var tdName = document.createElement("td");
    tdName.textContent = asset.Asset_Name || asset.Name || "—";
    tr.appendChild(tdName);

    // Asset ID / reference (show the record id)
    var tdRef = document.createElement("td");
    tdRef.textContent = asset.id || "—";
    tr.appendChild(tdRef);

    // Status
    var tdStatus = document.createElement("td");
    var badge = document.createElement("span");
    badge.className = "badge badge-available";
    badge.textContent = "Available";
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    $tbody.appendChild(tr);
  });

  updateSelectAllState();
}

// ──────────────────────────────────────────────────────────────
//  SELECTION
// ──────────────────────────────────────────────────────────────

function toggleSelection(assetId, isChecked, row) {
  if (isChecked) {
    selectedIds.add(assetId);
    row.classList.add("selected");
  } else {
    selectedIds.delete(assetId);
    row.classList.remove("selected");
  }
  updateSelectedCount();
  updateSelectAllState();
}

function updateSelectedCount() {
  var count = selectedIds.size;
  $selectedCount.textContent = count + " selected";
  $assignBtn.disabled = count === 0 || isSaving;
}

function updateSelectAllState() {
  var checkboxes = $tbody.querySelectorAll('input[type="checkbox"]');
  var allChecked = checkboxes.length > 0;
  checkboxes.forEach(function (cb) {
    if (!cb.checked) allChecked = false;
  });
  $selectAll.checked = allChecked && checkboxes.length > 0;
}

// ──────────────────────────────────────────────────────────────
//  EVENTS
// ──────────────────────────────────────────────────────────────

function bindEvents() {
  // Select-all toggle
  $selectAll.addEventListener("change", function () {
    var checked = $selectAll.checked;
    var rows = $tbody.querySelectorAll("tr");
    rows.forEach(function (row) {
      var cb = row.querySelector('input[type="checkbox"]');
      if (!cb) return;
      var id = row.getAttribute("data-id");
      cb.checked = checked;
      if (checked) {
        selectedIds.add(id);
        row.classList.add("selected");
      } else {
        selectedIds.delete(id);
        row.classList.remove("selected");
      }
    });
    updateSelectedCount();
  });

  // Search / filter
  $searchInput.addEventListener("input", function () {
    var term = $searchInput.value.trim().toLowerCase();
    var filtered = availableAssets.filter(function (a) {
      var name = (a.Asset_Name || a.Name || "").toLowerCase();
      var id   = (a.id || "").toLowerCase();
      return name.indexOf(term) !== -1 || id.indexOf(term) !== -1;
    });
    renderAssetsTable(filtered);
  });

  // Assign button
  $assignBtn.addEventListener("click", handleAssignEquipment);
}

// ──────────────────────────────────────────────────────────────
//  ASSIGN / CREATE RECORDS
// ──────────────────────────────────────────────────────────────

async function handleAssignEquipment() {
  if (selectedIds.size === 0 || isSaving) return;

  isSaving = true;
  $assignBtn.disabled = true;
  $assignBtn.textContent = "Saving...";
  hideResultBanner();

  try {
    var results = await createDealsXAssetsRecords(Array.from(selectedIds));
    showResults(results);
  } catch (err) {
    console.error("[Widget] handleAssignEquipment error:", err);
    showResultBanner("error", "An unexpected error occurred while saving: " + (err.message || ""));
  } finally {
    isSaving = false;
    $assignBtn.disabled = selectedIds.size === 0;
    $assignBtn.textContent = "Assign Equipment";
  }
}

/**
 * Create one Deals_X_Assets record per selected asset.
 * Returns { successes: number, failures: number, errors: [] }
 */
async function createDealsXAssetsRecords(assetIds) {
  var successes = 0;
  var failures  = 0;
  var errors    = [];

  // Build record data array
  var recordData = assetIds.map(function (assetId) {
    var rec = {};
    rec[DXA_RELATED_DEAL]       = { id: dealId };
    rec[DXA_ASSIGNED_EQUIPMENT] = { id: assetId };
    rec[DXA_BOOKING_START]      = formatDateISO(requestedStart);
    rec[DXA_BOOKING_END]        = formatDateISO(requestedEnd);
    return rec;
  });

  // Zoho CRM insertRecord supports up to 100 records per call.
  // Batch in chunks of 100.
  var chunks = chunkArray(recordData, 100);

  for (var i = 0; i < chunks.length; i++) {
    try {
      console.log("[Widget] Inserting chunk " + (i + 1) + " of " + chunks.length, chunks[i]);

      var resp = await ZOHO.CRM.API.insertRecord({
        Entity: MODULE_DXA,
        APIData: {
          data: chunks[i]
        },
        Trigger: []
      });

      console.log("[Widget] insertRecord response:", resp);

      if (resp && resp.data) {
        resp.data.forEach(function (r) {
          if (r.code === "SUCCESS") {
            successes++;
          } else {
            failures++;
            errors.push(r.message || r.code || "Unknown error");
          }
        });
      } else {
        // Entire chunk failed
        failures += chunks[i].length;
        errors.push("No response data for batch " + (i + 1));
      }
    } catch (err) {
      console.error("[Widget] Batch insert error:", err);
      failures += chunks[i].length;
      errors.push(err.message || "Batch insert exception");
    }
  }

  return { successes: successes, failures: failures, errors: errors };
}

// ──────────────────────────────────────────────────────────────
//  UI HELPERS
// ──────────────────────────────────────────────────────────────

function showResults(results) {
  if (results.failures === 0) {
    showResultBanner(
      "success",
      "Successfully assigned " + results.successes + " asset(s) to this Deal."
    );
    // Clear selection after full success
    selectedIds.clear();
    updateSelectedCount();
    // Optionally remove assigned rows from the table
    renderAssetsTable(availableAssets.filter(function (a) {
      return !Array.from(selectedIds).length; // all cleared
    }));
  } else if (results.successes > 0) {
    showResultBanner(
      "partial",
      results.successes + " asset(s) assigned. " +
      results.failures + " failed: " + results.errors.join("; ")
    );
  } else {
    showResultBanner(
      "error",
      "All assignments failed. " + results.errors.join("; ")
    );
  }
}

function showResultBanner(type, message) {
  $resultBanner.className = "result-banner " + type;
  $resultBanner.textContent = message;
  $resultBanner.classList.remove("hidden");
}

function hideResultBanner() {
  $resultBanner.classList.add("hidden");
}

function showLoading(visible) {
  if (visible) {
    show($loading);
    hide($empty);
    hide($error);
    hide($toolbar);
    hide($tableContainer);
  } else {
    hide($loading);
  }
}

function showEmpty(msg) {
  document.querySelector("#empty-state p").textContent = msg || "No available assets.";
  show($empty);
  hide($tableContainer);
  // Keep toolbar visible for context but hide search
  show($toolbar);
}

function showError(msg) {
  $errorText.textContent = msg;
  show($error);
  hide($loading);
  hide($toolbar);
  hide($tableContainer);
  hide($empty);
}

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

// ──────────────────────────────────────────────────────────────
//  DATE HELPERS
// ──────────────────────────────────────────────────────────────

/**
 * Parse a Zoho date string (yyyy-MM-dd) into a Date at midnight UTC.
 * Returns null for falsy / unparseable values.
 */
function parseDate(val) {
  if (!val) return null;
  var d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/** Format a Date object for display: dd MMM yyyy */
function formatDate(d) {
  if (!d) return "—";
  var months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
  ];
  return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
}

/** Format Date as yyyy-MM-dd for the Zoho API */
function formatDateISO(d) {
  if (!d) return null;
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}

// ──────────────────────────────────────────────────────────────
//  GENERAL HELPERS
// ──────────────────────────────────────────────────────────────

/** Split an array into chunks of the given size */
function chunkArray(arr, size) {
  var chunks = [];
  for (var i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
