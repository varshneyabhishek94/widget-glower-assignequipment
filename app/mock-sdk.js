/*  ============================================================
 *  LOCAL MOCK — Zoho Embedded App SDK
 *  ============================================================
 *  This file is loaded ONLY for local development.  It stubs
 *  ZOHO.embeddedApp and ZOHO.CRM.API so the widget renders
 *  with sample data in a regular browser.
 *
 *  DO NOT include this file when packaging for Zoho CRM.
 *  ============================================================ */

(function () {
  "use strict";

  // Sample deal
  var MOCK_DEAL = {
    id: "1110000000012345",
    Deal_Name: "Acme Corp — Summer Event",
    Requested_Start_Date: "2026-06-15",
    Requested_End_Date: "2026-06-20"
  };

  // Sample assets
  var MOCK_ASSETS = [
    { id: "2220000000001001", Asset_Name: "LED Wall 4x3m",        Name: "LED Wall 4x3m" },
    { id: "2220000000001002", Asset_Name: "Sound System A",       Name: "Sound System A" },
    { id: "2220000000001003", Asset_Name: "Projector HD-500",     Name: "Projector HD-500" },
    { id: "2220000000001004", Asset_Name: "Stage Platform 6x4m",  Name: "Stage Platform 6x4m" },
    { id: "2220000000001005", Asset_Name: "Lighting Rig XL",      Name: "Lighting Rig XL" },
    { id: "2220000000001006", Asset_Name: "Fog Machine Pro",      Name: "Fog Machine Pro" },
    { id: "2220000000001007", Asset_Name: "Generator 20kW",       Name: "Generator 20kW" },
    { id: "2220000000001008", Asset_Name: "Truss Set 12m",        Name: "Truss Set 12m" }
  ];

  // Sample existing bookings — assets 1002 and 1005 overlap the deal dates
  var MOCK_DXA = [
    {
      id: "3330000000099001",
      Related_Deals:      { id: "1110000000099999", name: "Other Deal" },
      Assigned_Equipment: { id: "2220000000001002", name: "Sound System A" },
      Booking_Start_Date: "2026-06-14",
      Booking_End_Date:   "2026-06-17",
      Blocked_Start_Date: null,
      Blocked_End_Date:   null
    },
    {
      id: "3330000000099002",
      Related_Deals:      { id: "1110000000099999", name: "Other Deal" },
      Assigned_Equipment: { id: "2220000000001005", name: "Lighting Rig XL" },
      Booking_Start_Date: null,
      Booking_End_Date:   null,
      Blocked_Start_Date: "2026-06-18",
      Blocked_End_Date:   "2026-06-22"
    }
  ];

  // ── Stub ZOHO global ──────────────────────────────────────

  var pageLoadCallback = null;

  window.ZOHO = {
    embeddedApp: {
      on: function (event, cb) {
        if (event === "PageLoad") {
          pageLoadCallback = cb;
        }
      },
      init: function () {
        console.log("[MockSDK] init() — firing PageLoad with mock Deal ID");
        setTimeout(function () {
          if (pageLoadCallback) {
            pageLoadCallback({ EntityId: MOCK_DEAL.id });
          }
        }, 300);
      }
    },
    CRM: {
      API: {
        getRecord: function (opts) {
          console.log("[MockSDK] getRecord", opts);
          return Promise.resolve({ data: [MOCK_DEAL] });
        },

        getAllRecords: function (opts) {
          console.log("[MockSDK] getAllRecords", opts);
          var data = [];
          if (opts.Entity === "Assets")        data = MOCK_ASSETS;
          if (opts.Entity === "Deals_X_Assets") data = MOCK_DXA;
          return Promise.resolve({ data: data });
        },

        insertRecord: function (opts) {
          console.log("[MockSDK] insertRecord", opts);
          // Simulate success for every record in the payload
          var results = (opts.APIData.data || []).map(function (rec, i) {
            return {
              code: "SUCCESS",
              details: { id: "mock_new_" + Date.now() + "_" + i },
              message: "record added",
              status: "success"
            };
          });
          return new Promise(function (resolve) {
            setTimeout(function () {
              resolve({ data: results });
            }, 600);
          });
        }
      }
    }
  };

  console.log(
    "%c[MockSDK] Local mock active — 8 assets, 2 with overlapping bookings",
    "color: #1a73e8; font-weight: bold"
  );
})();
