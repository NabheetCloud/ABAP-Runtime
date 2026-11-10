@EndUserText.label : 'Billing document header'
define table vbrk {
  key mandt    : abap.clnt not null;
  key vbeln    : abap.char(10) not null;
  fkart        : abap.char(20);
  fktyp        : abap.char(20);
  vbtyp        : abap.char(4);
  vkorg        : abap.char(4);
  vtweg        : abap.char(2);
  fkdat        : abap.dats;
  kunrg        : abap.char(10);
  kunag        : abap.char(10);
  @Semantics.amount.currencyCode : 'vbrk.waerk'
  netwr        : abap.curr(15,2);
  @Semantics.amount.currencyCode : 'vbrk.waerk'
  mwsbk        : abap.curr(15,2);
  waerk        : abap.cuky;
  knumv        : abap.char(10);
  bukrs        : abap.char(4);
  rfbsk        : abap.char(20);
  fksto        : abap.char(20);
  sfakn        : abap.char(20);
  xblnr        : abap.char(16);
  zterm        : abap.char(4);
  erdat        : abap.dats;
  ernam        : abap.char(12);
  spart        : abap.char(2);
  belnr        : abap.char(10);
  gjahr        : abap.numc(4);
  land1        : abap.char(3);
  erzet        : abap.tims;
  fkdat_rl     : abap.dats;
  inco1        : abap.char(3);
  kurrf        : abap.dec(15,3);
}
