@EndUserText.label : 'Notification activities'
define table qmma {
  key mandt : abap.clnt not null;
  key qmnum : abap.char(12) not null;
  key manum : abap.numc(4) not null;
  mnkat     : abap.char(20);
  mngrp     : abap.char(8);
  mncod     : abap.char(4);
  erdat     : abap.dats;
  matxt     : abap.char(40);
}
