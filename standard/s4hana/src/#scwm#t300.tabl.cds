@EndUserText.label : 'Warehouse numbers'
define table /scwm/t300 {
  key mandt : abap.clnt not null;
  key lgnum : abap.char(4) not null;
  lnumt     : abap.char(40);
  werks     : abap.char(4);
  lgort     : abap.char(4);
}
