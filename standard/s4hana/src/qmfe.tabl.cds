@EndUserText.label : 'Notification items (defects)'
define table qmfe {
  key mandt    : abap.clnt not null;
  key qmnum    : abap.char(12) not null;
  key fenum    : abap.numc(4) not null;
  fekat        : abap.char(20);
  fegrp        : abap.char(8);
  fecod        : abap.char(4);
  otgrp        : abap.char(20);
  oteil        : abap.char(20);
  erzdatum     : abap.dats;
  fetxt        : abap.char(40);
  otkat        : abap.char(20);
}
