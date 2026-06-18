import { describe, expect, it, vi } from "vitest";
import {
  buildContactMap,
  csvEditionUrl,
  getCurrentNasrCsvEdition,
  getCurrentNasrEdition,
  mapNasrAptRecord,
  mapNasrCsvRecord,
  parseCsvRows,
  parseNasrCoordinate,
  parseNasrDate,
} from "./faa-utils.js";

describe("faa-utils", () => {
  it("normalizes NASR edition metadata from the FAA discovery API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          edition: [
            {
              editionDate: "03/19/2026",
              product: {
                url: "https://example.com/nasr.zip",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    );

    await expect(getCurrentNasrEdition(fetchImpl)).resolves.toEqual({
      dataset: "faa-nasr-2026-03-19-apt",
      downloadUrl: "https://example.com/nasr.zip",
    });
  });

  it("parses FAA NASR DMS coordinates", () => {
    expect(parseNasrCoordinate("374122.20N")).toBeCloseTo(37.6895, 4);
    expect(parseNasrCoordinate("1222257.40W")).toBeCloseTo(-122.3826, 4);
  });

  it("parses FAA date formats used by APT records", () => {
    expect(parseNasrDate("03/19/2026")?.toISOString()).toBe("2026-03-19T00:00:00.000Z");
    expect(parseNasrDate("03192026")?.toISOString()).toBe("2026-03-19T00:00:00.000Z");
    expect(parseNasrDate("2026-03-19")?.toISOString()).toBe("2026-03-19T00:00:00.000Z");
  });

  it("maps APT.TXT fixed-width airport rows into canonical airport payloads", () => {
    const line = buildAptLine([
      [1, 3, "APT"],
      [28, 4, "PAO"],
      [32, 10, "03/19/2026"],
      [49, 2, "CA"],
      [94, 40, "Palo Alto"],
      [134, 50, "Palo Alto Airport"],
      [524, 15, "374628.00N"],
      [551, 15, "1220654.00W"],
      [885, 8, "03182026"],
      [1211, 7, "KPAO"],
    ]);

    expect(mapNasrAptRecord(line, "faa-nasr-2026-03-19-apt")).toMatchObject({
      code: "KPAO",
      faaCode: "PAO",
      icaoCode: "KPAO",
      city: "Palo Alto",
      state: "CA",
      source: "FAA",
      sourceDataset: "faa-nasr-2026-03-19-apt",
    });
  });

  // --- New CSV format tests ---

  it("derives the CSV zip URL from an FAA edition date", () => {
    expect(csvEditionUrl("06/11/2026")).toBe(
      "https://nfdc.faa.gov/webContent/28DaySub/extra/11_Jun_2026_CSV.zip"
    );
  });

  it("normalizes CSV edition metadata from the FAA discovery API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          edition: [
            {
              editionDate: "06/11/2026",
              product: {
                url: "https://example.com/nasr.zip",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    );

    await expect(getCurrentNasrCsvEdition(fetchImpl)).resolves.toEqual({
      dataset: "faa-nasr-2026-06-11-apt",
      downloadUrl: "https://nfdc.faa.gov/webContent/28DaySub/extra/11_Jun_2026_CSV.zip",
    });
  });

  it("parseCsvRows handles basic CSV text", () => {
    const csv = "A,B,C\n1,2,3\n4,5,6";
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ A: "1", B: "2", C: "3" });
    expect(rows[1]).toEqual({ A: "4", B: "5", C: "6" });
  });

  it("parseCsvRows handles quoted fields with embedded commas", () => {
    const csv = 'NAME,CITY\n"SMITH, JOHN","NEW YORK, NY"';
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].NAME).toBe("SMITH, JOHN");
    expect(rows[0].CITY).toBe("NEW YORK, NY");
  });

  it("parseCsvRows handles escaped double-quotes inside quoted fields", () => {
    const csv = 'DESC\n"He said ""hello"""';
    const rows = parseCsvRows(csv);
    expect(rows[0].DESC).toBe('He said "hello"');
  });

  it("buildContactMap extracts owner and manager from APT_CON CSV", () => {
    const csv = [
      "EFF_DATE,SITE_NO,SITE_TYPE_CODE,STATE_CODE,ARPT_ID,CITY,COUNTRY_CODE,TITLE,NAME,ADDRESS1,ADDRESS2,TITLE_CITY,STATE,ZIP_CODE,ZIP_PLUS_FOUR,PHONE_NO",
      "06/11/2026,04508.A*A,A,CA,PAO,PALO ALTO,US,OWNER,CITY OF PALO ALTO,,,,CA,,,650-329-2400",
      "06/11/2026,04508.A*A,A,CA,PAO,PALO ALTO,US,MANAGER,JOHN DOE,,,,CA,,,650-329-2401",
    ].join("\n");

    const map = buildContactMap(csv);
    const contact = map.get("04508.A*A");
    expect(contact).toEqual({
      ownerName: "CITY OF PALO ALTO",
      ownerPhone: "650-329-2400",
      managerName: "JOHN DOE",
      managerPhone: "650-329-2401",
    });
  });

  it("maps an APT_BASE CSV row with contacts to canonical airport payload", () => {
    const row = {
      EFF_DATE: "06/11/2026",
      SITE_NO: "04508.A*A",
      SITE_TYPE_CODE: "A",
      STATE_CODE: "CA",
      ARPT_ID: "PAO",
      CITY: "PALO ALTO",
      COUNTRY_CODE: "US",
      REGION_CODE: "AWP",
      ADO_CODE: "",
      STATE_NAME: "CALIFORNIA",
      COUNTY_NAME: "SANTA CLARA",
      COUNTY_ASSOC_STATE: "CA",
      ARPT_NAME: "PALO ALTO ARPT OF SANTA CLARA CO",
      OWNERSHIP_TYPE_CODE: "PU",
      FACILITY_USE_CODE: "PU",
      LAT_DEG: "37",
      LAT_MIN: "27",
      LAT_SEC: "53.8100",
      LAT_HEMIS: "N",
      LAT_DECIMAL: "37.464947",
      LONG_DEG: "122",
      LONG_MIN: "6",
      LONG_SEC: "54.0000",
      LONG_HEMIS: "W",
      LONG_DECIMAL: "122.115000",
      SURVEY_METHOD_CODE: "S",
      ELEV: "7",
      ELEV_METHOD_CODE: "E",
      MAG_VARN: "14",
      MAG_HEMIS: "E",
      MAG_VARN_YEAR: "2025",
      TPA: "800",
      CHART_NAME: "SAN FRANCISCO",
      DIST_CITY_TO_AIRPORT: "3",
      DIRECTION_CODE: "NW",
      ACREAGE: "160",
      RESP_ARTCC_ID: "ZOA",
      COMPUTER_ID: "OAK",
      ARTCC_NAME: "OAKLAND",
      FSS_ON_ARPT_FLAG: "N",
      FSS_ID: "OAK",
      FSS_NAME: "OAKLAND",
      PHONE_NO: "",
      TOLL_FREE_NO: "",
      ALT_FSS_ID: "",
      ALT_FSS_NAME: "",
      ALT_TOLL_FREE_NO: "",
      NOTAM_ID: "PAO",
      NOTAM_FLAG: "D",
      ACTIVATION_DATE: "01/1946",
      ARPT_STATUS: "O",
      FAR_139_TYPE_CODE: "",
      FAR_139_CARRIER_SER_CODE: "",
      ARFF_CERT_TYPE_DATE: "",
      NASP_CODE: "",
      ASP_ANLYS_DTRM_CODE: "",
      CUST_FLAG: "N",
      LNDG_RIGHTS_FLAG: "N",
      JOINT_USE_FLAG: "N",
      MIL_LNDG_FLAG: "N",
      INSPECT_METHOD_CODE: "F",
      INSPECTOR_CODE: "F",
      LAST_INSPECTION: "03/18/2026",
      LAST_INFO_RESPONSE: "03/19/2026",
      FUEL_TYPES: "100LL JET-A",
      AIRFRAME_REPAIR_SER_CODE: "MAJOR",
      PWR_PLANT_REPAIR_SER: "MAJOR",
      BOTTLED_OXY_TYPE: "HIGH",
      BULK_OXY_TYPE: "HIGH",
      LGT_SKED: "SS-SR",
      BCN_LGT_SKED: "SS-SR",
      TWR_TYPE_CODE: "N",
      SEG_CIRCLE_MKR_FLAG: "Y",
      BCN_LENS_COLOR: "CG",
      LNDG_FEE_FLAG: "N",
      MEDICAL_USE_FLAG: "N",
      ARPT_PSN_SOURCE: "3SP",
      POSITION_SRC_DATE: "09/2006",
      ARPT_ELEV_SOURCE: "3SP",
      ELEVATION_SRC_DATE: "09/2006",
      CONTR_FUEL_AVBL: "N",
      TRNS_STRG_BUOY_FLAG: "N",
      TRNS_STRG_HGR_FLAG: "Y",
      TRNS_STRG_TIE_FLAG: "Y",
      OTHER_SERVICES: "STORAGE",
      WIND_INDCR_FLAG: "Y",
      ICAO_ID: "KPAO",
      MIN_OP_NETWORK: "N",
      USER_FEE_FLAG: "N",
      CTA: "",
    };

    const contacts = {
      ownerName: "CITY OF PALO ALTO",
      ownerPhone: "650-329-2400",
      managerName: "JOHN DOE",
      managerPhone: "650-329-2401",
    };

    const record = mapNasrCsvRecord(row, contacts, "faa-nasr-2026-06-11-apt");

    expect(record).toMatchObject({
      code: "KPAO",
      faaCode: "PAO",
      icaoCode: "KPAO",
      facilityType: "AIRPORT",
      ownershipType: "PU",
      airportUse: "PU",
      elevation: 7,
      faaRegionCode: "AWP",
      stateName: "CALIFORNIA",
      countyName: "SANTA CLARA",
      ownerName: "CITY OF PALO ALTO",
      ownerPhone: "650-329-2400",
      managerName: "JOHN DOE",
      managerPhone: "650-329-2401",
      magVariation: "14E",
      magVariationYear: "2025",
      trafficPatternAltitude: 800,
      sectionalChart: "SAN FRANCISCO",
      artccBoundaryId: null,
      artccResponsibleId: "ZOA",
      airportStatus: "O",
      fuelTypes: "100LL JET-A",
      controlTower: "N",
      // Fields not in CSV are null
      unicomFrequency: null,
      ctafFrequency: null,
      singleEngineCount: null,
      annualCommercialOps: null,
      // Transient storage
      transientStorageHangar: true,
      transientStorageTiedown: true,
      transientStorageBuoy: false,
      storageFacilities: "HGR TIE",
      city: "PALO ALTO",
      state: "CA",
      country: "US",
      source: "FAA",
      sourceDataset: "faa-nasr-2026-06-11-apt",
    });

    // Coordinates from pre-parsed decimal fields
    expect(record.latitude).toBeCloseTo(37.4649, 3);
    expect(record.longitude).toBeCloseTo(-122.115, 3);

    expect(record.sourceRecordUpdatedAt?.toISOString()).toBe("2026-06-11T00:00:00.000Z");
  });

  it("mapNasrCsvRecord skips non-US airports", () => {
    const row = {
      COUNTRY_CODE: "CA",
      LAT_DECIMAL: "45.0",
      LAT_HEMIS: "N",
      LONG_DECIMAL: "75.0",
      LONG_HEMIS: "W",
      ARPT_ID: "YOW",
      ICAO_ID: "CYOW",
      ARPT_NAME: "OTTAWA",
      CITY: "OTTAWA",
      STATE_CODE: "",
      SITE_TYPE_CODE: "A",
    };
    expect(mapNasrCsvRecord(row, null)).toBeNull();
  });

  it("mapNasrCsvRecord skips records with missing coordinates", () => {
    const row = {
      COUNTRY_CODE: "US",
      LAT_DECIMAL: "",
      LAT_HEMIS: "N",
      LONG_DECIMAL: "",
      LONG_HEMIS: "W",
      ARPT_ID: "TST",
      ICAO_ID: "",
      ARPT_NAME: "TEST AIRPORT",
      CITY: "TESTVILLE",
      STATE_CODE: "CA",
      SITE_TYPE_CODE: "A",
    };
    expect(mapNasrCsvRecord(row, null)).toBeNull();
  });

  it("mapNasrCsvRecord derives storageFacilities from flags", () => {
    const baseRow = {
      COUNTRY_CODE: "US",
      LAT_DECIMAL: "37.0",
      LAT_HEMIS: "N",
      LONG_DECIMAL: "122.0",
      LONG_HEMIS: "W",
      ARPT_ID: "TST",
      ICAO_ID: "",
      ARPT_NAME: "TEST AIRPORT",
      CITY: "TESTVILLE",
      STATE_CODE: "CA",
      SITE_TYPE_CODE: "A",
      TRNS_STRG_HGR_FLAG: "N",
      TRNS_STRG_TIE_FLAG: "N",
      TRNS_STRG_BUOY_FLAG: "Y",
      EFF_DATE: "",
    };

    // Fill remaining required fields with empty strings
    const row = new Proxy(baseRow, {
      get(target, prop) {
        return prop in target ? target[prop] : "";
      },
    });

    const record = mapNasrCsvRecord(row, null);
    expect(record.transientStorageHangar).toBe(false);
    expect(record.transientStorageTiedown).toBe(false);
    expect(record.transientStorageBuoy).toBe(true);
    expect(record.storageFacilities).toBe("BUOY");
  });
});

function buildAptLine(fields) {
  const chars = Array.from({ length: 1217 }, () => " ");

  for (const [start, length, value] of fields) {
    const padded = value.padEnd(length, " ");
    for (let index = 0; index < length; index += 1) {
      chars[start - 1 + index] = padded[index];
    }
  }

  return chars.join("");
}
