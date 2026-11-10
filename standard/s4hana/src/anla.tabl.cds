@EndUserText.label : 'Asset master general'
define table anla {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key anln1 : abap.char(12) not null;
  key anln2 : abap.char(4) not null;
  anlkl     : abap.char(8);
  aktiv     : abap.dats;
  deakt     : abap.dats;
  txt50     : abap.char(50);
  invnr     : abap.char(25);
  @Semantics.quantity.unitOfMeasure : 'anla.meins'
  menge     : abap.quan(13,3);
  meins     : abap.unit(3);
  lifnr     : abap.char(10);
  sernr     : abap.char(18);
  herst     : abap.char(30);
  kostl     : abap.char(10);
  werks     : abap.char(4);
  raumn     : abap.char(20);
  erdat     : abap.dats;
  ernam     : abap.char(12);
  ord41     : abap.char(4);
  txa50     : abap.char(50);
  zugdt     : abap.dats;
}
