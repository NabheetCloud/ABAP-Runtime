@EndUserText.label : 'Task list operation'
define table plpo {
  key mandt : abap.clnt not null;
  key plnty : abap.char(1) not null;
  key plnnr : abap.char(8) not null;
  key plnkn : abap.numc(8) not null;
  key zaehl : abap.numc(8) not null;
  vornr     : abap.char(4);
  arbid     : abap.char(20);
  steus     : abap.char(4);
  ltxa1     : abap.char(20);
  bmsch     : abap.dec(13,3);
  datuv     : abap.dats;
  vge01     : abap.char(20);
  vge02     : abap.char(20);
  vgw01     : abap.dec(15,3);
  vgw02     : abap.dec(15,3);
  werks     : abap.char(4);
}
