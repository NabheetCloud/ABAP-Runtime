@EndUserText.label : 'ArchiveLink links (HR)'
define table toahr {
  key mandt      : abap.clnt not null;
  key sap_object : abap.char(10) not null;
  key object_id  : abap.char(50) not null;
  key archiv_id  : abap.char(2) not null;
  key arc_doc_id : abap.char(40) not null;
  ar_object      : abap.char(10);
  ar_date        : abap.dats;
  reserve        : abap.char(20);
}
