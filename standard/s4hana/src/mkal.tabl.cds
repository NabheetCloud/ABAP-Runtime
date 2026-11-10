@EndUserText.label : 'Production versions'
define table mkal {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key werks : abap.char(4) not null;
  key verid : abap.char(4) not null;
  adatu     : abap.dats;
  bdatu     : abap.dats;
  stlal     : abap.char(2);
  stlan     : abap.char(1);
  plnty     : abap.char(1);
  plnnr     : abap.char(8);
  alnal     : abap.char(20);
  mdv01     : abap.char(20);
  text1     : abap.char(40);
}
