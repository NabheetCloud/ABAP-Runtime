@EndUserText.label : 'Exchange rate type texts'
define table tcurw {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key kurst : abap.char(4) not null;
  curvw     : abap.char(40);
}
