import { describe, expect, it } from "vitest";
import { matchVehicleByPlate, normalizePlate, parseFuelInvoiceXml } from "./fuel-invoice-parse";

// Realny przykład eksportu z Fakturowni (dostarczony przez użytkownika,
// R9l4K54zm32UgutWyajF.xml) — dokładnie ten format ma parser obsłużyć.
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<invoice>
  <kind>vat</kind>
  <number>F 31355/4493/26</number>
  <issue-date type="date">2026-09-12</issue-date>
  <payment-to type="date" nil="true"/>
  <payment-to-kind>off</payment-to-kind>
  <payment-type>card</payment-type>
  <sell-date>2026-09-12</sell-date>
  <sell-date-kind nil="true"/>
  <paid type="decimal">327.25</paid>
  <place nil="true"/>
  <price-gross type="decimal">327.25</price-gross>
  <price-net type="decimal">266.06</price-net>
  <price-tax type="decimal">61.19</price-tax>
  <currency>PLN</currency>
  <seller-name>ESTEGH SP.Z.O.O.</seller-name>
  <seller-street>UL. PODBORY 29A</seller-street>
  <seller-post-code>32-050</seller-post-code>
  <seller-city>SKAWINA</seller-city>
  <seller-country>PL</seller-country>
  <seller-bank nil="true"/>
  <seller-bank-account>41 1140 2004 0000 3302 8431 9961</seller-bank-account>
  <seller-bank-account-id type="integer" nil="true"/>
  <seller-email>kontakt@wynajemlasera.pl</seller-email>
  <seller-fax></seller-fax>
  <seller-person nil="true"/>
  <seller-phone>533313575</seller-phone>
  <seller-tax-no>9442285599</seller-tax-no>
  <seller-tax-no-kind nil="true"/>
  <seller-www>wynajemlasera.pl</seller-www>
  <delivery-address nil="true"/>
  <description>BDO 000007103</description>
  <description-footer></description-footer>
  <description-long nil="true"/>
  <discount type="decimal" nil="true"/>
  <discount-kind>amount</discount-kind>
  <exchange-currency nil="true"/>
  <exchange-currency-rate type="decimal" nil="true"/>
  <exchange-date type="date" nil="true"/>
  <exchange-kind>nbp</exchange-kind>
  <exchange-note></exchange-note>
  <exchange-rate type="decimal">1.0</exchange-rate>
  <income type="boolean">false</income>
  <lang>pl</lang>
  <oid nil="true"/>
  <buyer-company type="boolean">true</buyer-company>
  <buyer-name>ORLEN S.A.</buyer-name>
  <buyer-street>ul. Chemików 7</buyer-street>
  <buyer-post-code>09-411</buyer-post-code>
  <buyer-city>Płock</buyer-city>
  <buyer-country>PL</buyer-country>
  <buyer-bank></buyer-bank>
  <buyer-bank-account></buyer-bank-account>
  <buyer-email nil="true"/>
  <buyer-fax nil="true"/>
  <buyer-person></buyer-person>
  <buyer-phone>033 842-55-07
0</buyer-phone>
  <buyer-tax-no>7740001454</buyer-tax-no>
  <buyer-tax-no-kind nil="true"/>
  <buyer-www nil="true"/>
  <show-discount type="boolean">true</show-discount>
  <split-payment type="integer">0</split-payment>
  <buyer-mobile-phone nil="true"/>
  <seller-bdo-no nil="true"/>
  <seller-ksef-taxpayer-status nil="true"/>
  <e-receipt-view-url nil="true"/>
  <positions type="array">
    <position type="InvoicePosition">
      <name>EFECTA DIESEL CN27102011</name>
      <code>D01-000055</code>
      <additional-info nil="true"/>
      <quantity type="decimal">38.32</quantity>
      <quantity-unit>L</quantity-unit>
      <discount type="decimal">3.07</discount>
      <discount-percent type="decimal" nil="true"/>
      <price-net type="decimal">6.94311</price-net>
      <tax>23</tax>
      <tax2>0</tax2>
      <price-tax type="decimal">1.61187</price-tax>
      <price-gross type="decimal">8.62</price-gross>
      <total-price-net type="decimal">268.55</total-price-net>
      <total-price-tax type="decimal">61.77</total-price-tax>
      <total-price-gross type="decimal">330.32</total-price-gross>
    </position>
  </positions>
  <descriptions type="array">
    <description type="InvoiceAdditionalDescription">
      <kind>Opis</kind>
      <content>BDO 000007103</content>
      <position-index type="integer" nil="true"/>
      <row-number type="integer">1</row-number>
    </description>
    <description type="InvoiceAdditionalDescription">
      <kind>Opis</kind>
      <content>Karty paliwowe FLOTA-bezgotówkowe tankowanie dla firm. Informacje: 0801 235-682 z tel. stacjonarnych, 0501 235-682 z tel. kom.</content>
      <position-index type="integer" nil="true"/>
      <row-number type="integer">2</row-number>
    </description>
    <description type="InvoiceAdditionalDescription">
      <kind>Dokument wydania</kind>
      <content>302066041 (PV 73076K3/4493/26)</content>
      <position-index type="integer" nil="true"/>
      <row-number type="integer">3</row-number>
    </description>
    <description type="InvoiceAdditionalDescription">
      <kind>Nr. Pojazdu</kind>
      <content>DW9FF41 (PV 73076K3/4493/26)</content>
      <position-index type="integer" nil="true"/>
      <row-number type="integer">4</row-number>
    </description>
  </descriptions>
</invoice>
`;

describe("parseFuelInvoiceXml", () => {
  it("wyciąga podstawowe pola z realnego eksportu Fakturowni", () => {
    const parsed = parseFuelInvoiceXml(SAMPLE_XML);
    expect(parsed.invoiceNumber).toBe("F 31355/4493/26");
    expect(parsed.invoiceDate).toBe("2026-09-12");
    expect(parsed.sellerName).toBe("ESTEGH SP.Z.O.O.");
    expect(parsed.amountNet).toBe(266.06);
    expect(parsed.amountGross).toBe(327.25);
    expect(parsed.currency).toBe("PLN");
  });

  it("wyciąga nr rejestracyjny z pola 'Nr. Pojazdu', ucinając dopisek w nawiasie", () => {
    expect(parseFuelInvoiceXml(SAMPLE_XML).vehiclePlateRaw).toBe("DW9FF41");
  });

  it("nie myli 'Nr. Pojazdu' z innymi opisami (np. 'Dokument wydania')", () => {
    const withoutPlate = SAMPLE_XML.replace(
      /<description type="InvoiceAdditionalDescription">\s*<kind>Nr\. Pojazdu<\/kind>[\s\S]*?<\/description>/,
      "",
    );
    expect(parseFuelInvoiceXml(withoutPlate).vehiclePlateRaw).toBeNull();
  });

  it("pusta faktura (brak wszystkich pól) -> same null, nie rzuca wyjątku", () => {
    expect(parseFuelInvoiceXml("<invoice></invoice>")).toEqual({
      invoiceNumber: null,
      invoiceDate: null,
      sellerName: null,
      amountNet: null,
      amountGross: null,
      currency: null,
      vehiclePlateRaw: null,
    });
  });

  it("brak <descriptions> w ogóle -> vehiclePlateRaw null, reszta pól nadal działa", () => {
    const noDescriptions = SAMPLE_XML.replace(/<descriptions[\s\S]*<\/descriptions>/, "");
    const parsed = parseFuelInvoiceXml(noDescriptions);
    expect(parsed.vehiclePlateRaw).toBeNull();
    expect(parsed.amountGross).toBe(327.25);
  });
});

describe("normalizePlate", () => {
  it("usuwa spacje/myślniki i wielkie litery", () => {
    expect(normalizePlate("dw 9ff-41")).toBe("DW9FF41");
  });
});

describe("matchVehicleByPlate", () => {
  const vehicles = [
    { id: "v1", plateNumber: "DW9FF41" },
    { id: "v2", plateNumber: "KR 12345" },
  ];

  it("dopasowuje mimo różnic w spacjach/wielkości liter", () => {
    expect(matchVehicleByPlate("dw9ff41", vehicles)).toBe("v1");
    expect(matchVehicleByPlate("KR12345", vehicles)).toBe("v2");
  });

  it("brak dopasowania -> null", () => {
    expect(matchVehicleByPlate("ZZ99999", vehicles)).toBeNull();
  });

  it("brak numeru na fakturze -> null", () => {
    expect(matchVehicleByPlate(null, vehicles)).toBeNull();
  });
});
