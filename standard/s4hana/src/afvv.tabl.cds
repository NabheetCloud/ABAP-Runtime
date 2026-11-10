@EndUserText.label : 'Operation quantities/dates/values'
define table afvv {
  key mandt : abap.clnt not null;
  key aufpl : abap.numc(10) not null;
  key aplzl : abap.numc(8) not null;
  mgvrg     : abap.dec(13,3);
  lmnga     : abap.dec(13,3);
  fsavd     : abap.dats;
  fsedd     : abap.dats;
  ism01     : abap.dec(13,3);
  meinh     : abap.unit(3);
  vge01     : abap.char(20);
  vgw01     : abap.dec(15,3);
}
