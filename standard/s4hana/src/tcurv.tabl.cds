@EndUserText.label : 'Exchange rate types'
define table tcurv {
  key mandt : abap.clnt not null;
  key kurst : abap.char(4) not null;
  xinvr     : abap.char(1);
}
