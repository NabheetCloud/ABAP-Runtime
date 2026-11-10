@EndUserText.label : 'Forecast parameters'
define table mapr {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key werks : abap.char(4) not null;
  pnum1     : abap.char(10);
  prmod     : abap.char(1);
}
