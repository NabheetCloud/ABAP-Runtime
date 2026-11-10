@EndUserText.label: 'Flight (custom entity)'
@ObjectModel.query.implementedBy: 'ABAP:ZCL_FLIGHT_QUERY'
@UI.headerInfo: { typeName: 'Flight', typeNamePlural: 'Flights' }
define custom entity ZCE_Flight
{
      @UI.lineItem: [{ position: 10 }]
  key CarrierId    : abap.char(3);
      @UI.lineItem: [{ position: 20 }]
  key ConnectionId : abap.numc(4);
      @UI.lineItem: [{ position: 30 }]
      CityFrom     : abap.char(40);
      @UI.lineItem: [{ position: 40 }]
      Price        : abap.dec(11,2);
      PriceClass   : abap.char(10);
}
