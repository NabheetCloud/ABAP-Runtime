@EndUserText.label : 'Notification causes'
define table qmur {
  key mandt : abap.clnt not null;
  key qmnum : abap.char(12) not null;
  key fenum : abap.numc(4) not null;
  key urnum : abap.numc(4) not null;
  urkat     : abap.char(20);
  urgrp     : abap.char(8);
  urcod     : abap.char(4);
  urtxt     : abap.char(40);
}
