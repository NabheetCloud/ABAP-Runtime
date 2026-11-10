@EndUserText.label : 'Order master (internal, production, maintenance)'
define table aufk {
  key mandt : abap.clnt not null;
  key aufnr : abap.char(12) not null;
  auart     : abap.char(4);
  autyp     : abap.char(20);
  kokrs     : abap.char(4);
  bukrs     : abap.char(4);
  werks     : abap.char(4);
  kostv     : abap.char(10);
  prctr     : abap.char(10);
  objnr     : abap.char(22);
  erdat     : abap.dats;
  ktext     : abap.char(40);
  ernam     : abap.char(12);
  aedat     : abap.dats;
  astnr     : abap.char(20);
  waers     : abap.cuky;
  pspel     : abap.char(20);
}
