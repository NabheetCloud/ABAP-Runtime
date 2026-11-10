@EndUserText.label : 'Business partners'
define table but000 {
  key mandt        : abap.clnt not null;
  key partner      : abap.char(10) not null;
  type             : abap.char(1);
  bu_group         : abap.char(4);
  bu_sort1         : abap.char(20);
  name_org1        : abap.char(40);
  name_org2        : abap.char(40);
  name_first       : abap.char(40);
  name_last        : abap.char(40);
  xblck            : abap.char(1);
  xdele            : abap.char(1);
  crdat            : abap.dats;
  crusr            : abap.char(12);
  chdat            : abap.dats;
  partner_guid     : abap.raw(16);
  birthdt          : abap.char(20);
}
