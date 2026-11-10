@EndUserText.label : 'Booking - draft table'
define table zbooking_d {
  key mandt            : abap.clnt not null;
  key bookinguuid      : sysuuid_x16 not null;
  traveluuid           : sysuuid_x16;
  bookingid            : abap.numc(4);
  bookingdate          : abap.dats;
  carrierid            : abap.char(3);
  flightdate           : abap.dats;
  flightprice          : abap.curr(16,2);
  currencycode         : abap.cuky;
  bookingstatus        : abap.char(1);
  locallastchangedat   : abp_locinst_lastchange_tstmpl;
  "%admin"             : include sych_bdl_draft_admin_inc;
}
