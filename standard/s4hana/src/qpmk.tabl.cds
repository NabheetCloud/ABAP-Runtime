@EndUserText.label : 'Master inspection characteristics'
define table qpmk {
  key mandt     : abap.clnt not null;
  key zaehler   : abap.numc(8) not null;
  key mkmnr     : abap.char(8) not null;
  key version   : abap.numc(6) not null;
  kurztext      : abap.char(40);
  steuerkz      : abap.char(20);
  gueltigab     : abap.dats;
  loekz         : abap.char(1);
}
